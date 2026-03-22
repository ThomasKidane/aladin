(() => {
  console.log("[WXT-sheets] Injected script running in main world.");

  if (window.__canvasPatched) {
    console.log("[WXT-sheets] Canvas prototype already patched. Skipping.");
    return;
  }

  window.__canvasPatched = true;

  let sheetDataLocator = null;
  let lastParsedSheetData = null;

  function colToIndex(col) {
    let index = 0;
    for (let i = 0; i < col.length; i++) {
      index = index * 26 + (col.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  function formatSheetData(parsedData) {
    if (!parsedData || Object.keys(parsedData).length === 0) {
      return "Error: No sheet data available to process.";
    }

    const headers = new Map();
    const rows = new Map();
    const columns = new Set();

    for (const cellId in parsedData) {
      const match = cellId.match(/([A-Z]+)(\d+)/);
      if (!match) continue;
      const col = match[1];
      const row = parseInt(match[2], 10);
      const value = parsedData[cellId];

      columns.add(col);
      if (row === 1) {
        headers.set(col, value);
        continue;
      }
      if (!rows.has(row)) {
        rows.set(row, new Map());
      }
      rows.get(row).set(col, value);
    }

    const orderedCols = [...columns].sort(
      (a, b) => colToIndex(a) - colToIndex(b)
    );
    if (orderedCols.length === 0) {
      return "Error: No sheet data available to process.";
    }

    const headerLine = orderedCols.map((col) => headers.get(col) ?? col);
    const rowNumbers = [...rows.keys()].sort((a, b) => a - b);
    const headerNames = headerLine.map((value) =>
      typeof value === "string" ? value : String(value ?? "")
    );
    const dateColumnIndexes = new Set(
      headerNames
        .map((name, idx) => (name.toLowerCase().includes("date") ? idx : -1))
        .filter((idx) => idx >= 0)
    );

    const toDateString = (serial) => {
      if (typeof serial !== "number" || Number.isNaN(serial)) return serial;
      const base = Date.UTC(1899, 11, 30);
      const date = new Date(base + Math.round(serial) * 86400000);
      const month = date.getUTCMonth() + 1;
      const day = date.getUTCDate();
      return `${month}/${day}`;
    };

    const normalizeValue = (value, colIndex) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "number") {
        const normalized = dateColumnIndexes.has(colIndex)
          ? toDateString(value)
          : value;
        const asString = String(normalized);
        return asString.endsWith(".0") ? asString.slice(0, -2) : asString;
      }
      return String(value);
    };

    const dataLines = rowNumbers
      .map((row) => {
        const rowValues = rows.get(row) ?? new Map();
        const values = orderedCols.map((col, idx) =>
          normalizeValue(rowValues.get(col), idx)
        );
        const hasAny = values.some((val) => String(val ?? "").trim() !== "");
        return hasAny ? values : null;
      })
      .filter((row) => row !== null);

    return [headerNames, ...dataLines];
  }

  function indexToCol(index) {
    let col = "";
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      col = String.fromCharCode(65 + rem) + col;
      n = Math.floor((n - 1) / 26);
    }
    return col;
  }

  function extractCellValue(cell) {
    if (!cell) return undefined;
    const cellValue = cell["3"];
    if (Array.isArray(cellValue)) {
      if (cellValue.length > 1 && typeof cellValue[1] !== "object") {
        return { value: cellValue[1], isRef: false };
      }
      if (cellValue.length === 1 && typeof cellValue[0] === "object") {
        const inner = cellValue[0];
        if (inner && Object.prototype.hasOwnProperty.call(inner, "3")) {
          return { value: inner["3"], isRef: false };
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(cell, "25")) {
      return { value: cell["25"], isRef: false };
    }
    return undefined;
  }

  function isSheetData(data) {
    if (!Array.isArray(data) || data.length < 3 || !data[0]) {
      return false;
    }
    const meta = data[0];
    if (!Array.isArray(meta) || typeof meta[2] !== "number" || typeof meta[4] !== "number") {
      return false;
    }
    const cells = data[3] ?? data[2];
    if (!Array.isArray(cells)) {
      return false;
    }
    return true;
  }

  function isRangeData(data) {
    if (!Array.isArray(data) || data.length < 2) return false;
    const meta = data[0];
    if (!Array.isArray(meta) || meta.length < 5) return false;
    if (
      typeof meta[1] !== "number" ||
      typeof meta[2] !== "number" ||
      typeof meta[3] !== "number" ||
      typeof meta[4] !== "number"
    ) {
      return false;
    }
    return typeof data[1] === "object" && data[1] !== null;
  }

  function parseRangeData(data) {
    const meta = data[0];
    const startRow = meta[1];
    const endRow = meta[2];
    const startCol = meta[3];
    const endCol = meta[4];
    if (endRow <= startRow || endCol <= startCol) return {};

    const cellObj = data[1];
    const extracted = extractCellValue(cellObj);
    if (!extracted) return {};

    const parsedData = {};
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const rowIndex = row + 1;
        const colLetter = indexToCol(col);
        const cellId = `${colLetter}${rowIndex}`;
        parsedData[cellId] = extracted.value;
      }
    }
    return parsedData;
  }

  function executeParsing(data) {
    const meta = data[0];
    const numRows = meta[2];
    const numCols = meta[4];
    const cells = data[3] ?? data[2];

    if (!cells || cells.length === 0) return {};

    const firstCell = cells[0];
    const isSparse =
      Array.isArray(firstCell) &&
      firstCell.length === 3 &&
      typeof firstCell[0] === "number" &&
      typeof firstCell[1] === "number" &&
      Array.isArray(firstCell[2]);

    const parsedData = {};
    const valueMap = new Array(cells.length);
    const valueIsRef = new Array(cells.length).fill(false);

    const resolveReference = (
      index,
      value,
      isRef,
      isSparseMode,
      nonEmptyCellIndices
    ) => {
      if (!isRef || typeof value !== "number" || !Number.isInteger(value)) {
        return value;
      }
      const visited = new Set();
      let resolvedValue = value;
      while (typeof resolvedValue === "number" && Number.isInteger(resolvedValue)) {
        if (visited.has(resolvedValue)) {
          console.warn(
            `[WXT-sheets] Cycle detected in ${isSparseMode ? "sparse" : "dense"} cell references for ref ${resolvedValue}`
          );
          return value;
        }
        visited.add(resolvedValue);
        if (isSparseMode) {
          const nextValue = valueMap[resolvedValue];
          if (nextValue === undefined) return value;
          resolvedValue = nextValue;
        } else {
          const targetIndex = nonEmptyCellIndices[resolvedValue];
          if (targetIndex === undefined) return value;
          const nextValue = valueMap[targetIndex];
          if (nextValue === undefined) return value;
          resolvedValue = nextValue;
        }
      }
      return resolvedValue;
    };

    const shouldKeepValue = (value) => {
      if (value === null || value === undefined) return false;
      if (typeof value === "string" && value.trim() === "") return false;
      return true;
    };

    if (isSparse) {
      // SPARSE MODE
      for (let i = 0; i < cells.length; i++) {
        const cellDataArray = cells[i][2];
        if (!cellDataArray || !cellDataArray[0]) continue;
        const cell = cellDataArray[0];
        const extracted = extractCellValue(cell);
        if (extracted) {
          valueMap[i] = extracted.value;
          valueIsRef[i] = extracted.isRef;
        }
      }

      for (let i = 0; i < cells.length; i++) {
        let value = valueMap[i];
        if (value === undefined) continue;
        value = resolveReference(i, value, valueIsRef[i], true);
        if (value !== undefined) {
          const row = cells[i][0] + 1;
          const col = cells[i][1];
          const colLetter = indexToCol(col);
          const cellId = `${colLetter}${row}`;
          if (shouldKeepValue(value)) {
            parsedData[cellId] = value;
          }
        }
      }
    } else {
      // DENSE MODE
      const nonEmptyCellIndices = [];
      for (let i = 0; i < cells.length; i++) {
        const cellArray = cells[i];
        if (!cellArray || !cellArray[0]) continue;
        const cell = cellArray[0];
        if (cell && Object.keys(cell).length > 0) {
          nonEmptyCellIndices.push(i);
        }
        const extracted = extractCellValue(cell);
        if (extracted) {
          valueMap[i] = extracted.value;
          valueIsRef[i] = extracted.isRef;
        }
      }

      for (let i = 0; i < cells.length; i++) {
        let value = valueMap[i];
        if (value === undefined) continue;
        value = resolveReference(
          i,
          value,
          valueIsRef[i],
          false,
          nonEmptyCellIndices
        );
        if (value !== undefined) {
          const rowIndex = Math.floor(i / numCols) + 1;
          const colIndex = i % numCols;
          const colLetter = indexToCol(colIndex);
          const cellId = `${colLetter}${rowIndex}`;
          if (shouldKeepValue(value)) {
            parsedData[cellId] = value;
          }
        }
      }
    }
    return parsedData;
  }

  function parseSheetData(rawData) {
    let data;
    if (typeof rawData === "string") {
      try {
        data = JSON.parse(rawData);
      } catch {
        return {}; // Not JSON
      }
    } else {
      data = rawData;
    }

    return collectFromCandidate(data);
  }

  function collectFromCandidate(candidate) {
    let merged = {};
    if (isSheetData(candidate)) {
      merged = { ...merged, ...executeParsing(candidate) };
      return merged;
    }
    if (isRangeData(candidate)) {
      merged = { ...merged, ...parseRangeData(candidate) };
      return merged;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (isSheetData(item)) {
          merged = { ...merged, ...executeParsing(item) };
          continue;
        }
        if (isRangeData(item)) {
          merged = { ...merged, ...parseRangeData(item) };
        }
      }
    }
    return merged;
  }

  function findTextInWindow(searchText) {
    const visited = new Set();
    const results = [];

    const isLikelySheetPayload = (value) => {
      if (!Array.isArray(value)) return false;
      if (value.length === 0) return false;
      const first = value[0];
      return Array.isArray(first) || typeof first === "object";
    };

    function dfs(obj, path) {
      if (!obj || typeof obj !== "object" || visited.has(obj)) {
        return;
      }
      visited.add(obj);

      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const newPath = [...path, key];
          const currentPath = newPath.join(".");

          if (typeof key === "string" && key.startsWith(searchText)) {
            results.push({ path: currentPath, value: "Found in key" });
          }

          try {
            const value = obj[key];

            if (typeof value === "string" && value.startsWith(searchText)) {
              results.push({ path: currentPath, value });
            }

            if (isLikelySheetPayload(value)) {
              results.push({ path: currentPath, value });
            }

            if (typeof value === "object") {
              dfs(value, newPath);
            }
          } catch {
            // Ignore access errors
          }
        }
      }
    }

    dfs(window, ["window"]);
    return results;
  }

  function findTextInWindowIncludes(searchText) {
    const visited = new Set();
    const results = [];

    const isLikelySheetPayload = (value) => {
      if (!Array.isArray(value)) return false;
      if (value.length === 0) return false;
      const first = value[0];
      return Array.isArray(first) || typeof first === "object";
    };

    function dfs(obj, path) {
      if (!obj || typeof obj !== "object" || visited.has(obj)) {
        return;
      }
      visited.add(obj);

      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const newPath = [...path, key];
          const currentPath = newPath.join(".");

          if (typeof key === "string" && key.includes(searchText)) {
            results.push({ path: currentPath, value: "Found in key" });
          }

          try {
            const value = obj[key];

            if (typeof value === "string" && value.includes(searchText)) {
              results.push({ path: currentPath, value });
            }

            if (isLikelySheetPayload(value)) {
              results.push({ path: currentPath, value });
            }

            if (typeof value === "object") {
              dfs(value, newPath);
            }
          } catch {
            // Ignore access errors
          }
        }
      }
    }

    dfs(window, ["window"]);
    return results;
  }

  function getValueFromPath(path) {
    try {
      const pathParts = path.split(".");
      if (pathParts[0] !== "window") {
        console.warn(
          '[WXT-sheets] Locator path does not start with "window":',
          path
        );
        return undefined;
      }

      let value = window;
      for (let i = 1; i < pathParts.length; i++) {
        if (value === undefined || value === null) return undefined;
        value = value[pathParts[i]];
      }
      return value;
    } catch (e) {
      console.error("[WXT-sheets] Error resolving locator path:", path, e);
      return undefined;
    }
  }

  window.addEventListener("find-text-in-window", (e) => {
    const searchText = e.detail;
    if (typeof searchText !== "string") return;

    const tryParse = (value, path, bucket) => {
      console.log("[WXT-sheets] Raw data at path:", path, value);
      const parsed = parseSheetData(value);
      if (Object.keys(parsed).length > 0) {
        console.log(`[WXT-sheets] Parsed data for finding at path: ${path}`);
        console.table(parsed);
        sheetDataLocator = { path }; // Cache the successful locator
        console.log("[WXT-sheets] Caching successful locator:", sheetDataLocator);
        bucket.data = { ...bucket.data, ...parsed };
        return true;
      }
      return false;
    };

    const directPaths = [
      "window.document.__wizmanager.Ca.ma.ja.0.Ca.Iba.listeners.ic.0.qe.xa.32.src.Iba.listeners.zb.1.qe.ma.Iba.listeners.readonly_status.0.qe.po.2.xa.49.src.Iba.listeners.la.12.qe.ea.qa.Mba.docs-need-chrome-app-notification-install-extension.za.wa.1.po.3.Xb.ma.1.qa.0.1",
      "window.document.__wizmanager.Ca.ma.ja.0.Ca.Iba.listeners.ic.0.qe.xa.32.src.Iba.listeners.zb.1.qe.ma.Iba.listeners.readonly_status.0.qe.po.2.xa.49.src.Iba.listeners.la.12.qe.ea.qa.Mba.docs-need-chrome-app-notification-install-extension.za.wa.1.po.3.Xb.ma.1.qa.2.1",
    ];

    let found = false;
    const mergedBucket = { data: {} };

    // 1. Try direct paths
    for (const path of directPaths) {
      const value = getValueFromPath(path);
      if (value !== undefined) {
        if (tryParse(value, path, mergedBucket)) {
          found = true;
        }
      }
    }

    // 2. Try cached locator
    if (sheetDataLocator) {
      console.log(
        "[WXT-sheets] Direct paths failed. Attempting to use cached locator:",
        sheetDataLocator.path
      );
      const cachedValue = getValueFromPath(sheetDataLocator.path);
      if (cachedValue !== undefined) {
        if (tryParse(cachedValue, sheetDataLocator.path, mergedBucket)) {
          found = true;
        }
      } else {
        console.log("[WXT-sheets] Cached locator failed. Clearing.");
        sheetDataLocator = null;
      }
    }

    // 3. Fallback to search
    console.log(
      `[WXT-sheets] Direct paths and cache failed. Searching for "${searchText}" in window object.`
    );
    const findings = findTextInWindow(searchText);
    console.log("[WXT-sheets] Search results:");
    console.table(findings);

    for (const finding of findings) {
      if (tryParse(finding.value, finding.path, mergedBucket)) {
        found = true;
      }
    }

    if (!found) {
      console.log(
        `[WXT-sheets] Primary search failed. Re-running the primary search as a fallback for "${searchText}".`
      );
      const secondaryFindings = findTextInWindow(searchText);
      console.log("[WXT-sheets] Secondary search results:");
      console.table(secondaryFindings);

      for (const finding of secondaryFindings) {
        if (tryParse(finding.value, finding.path, mergedBucket)) {
          found = true;
        }
      }

      if (!found) {
        console.log(
          "[WXT-sheets] Exhausted all findings, no valid sheet data found."
        );
      }
    }

    if (found && Object.keys(mergedBucket.data).length > 0) {
      lastParsedSheetData = mergedBucket.data;
    }

    const event = new CustomEvent("found-text-in-window", {
      detail: found ? findings : [],
    });
    window.dispatchEvent(event);
  });

  window.addEventListener("get-sheet-data-request", async () => {
    const respondWithData = () => {
      const formatted = formatSheetData(lastParsedSheetData);
      const event = new CustomEvent("sheet-data-response", {
        detail: formatted,
      });
      window.dispatchEvent(event);
    };

    const respondWithError = (message) => {
      const event = new CustomEvent("sheet-data-response", {
        detail: message,
      });
      window.dispatchEvent(event);
    };

    if (lastParsedSheetData) {
      respondWithData();
      return;
    }

    const waitForParsedData = () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.removeEventListener("found-text-in-window", onFound);
          resolve(true);
        };

        const onFound = () => {
          if (lastParsedSheetData) {
            finish();
          }
        };

        const tick = () => {
          if (settled) return;
          if (lastParsedSheetData) {
            finish();
            return;
          }
          window.requestAnimationFrame(tick);
        };

        window.addEventListener("found-text-in-window", onFound);
        window.requestAnimationFrame(tick);
      });

    // Trigger a fresh search to populate lastParsedSheetData if possible.
    window.dispatchEvent(new CustomEvent("find-text-in-window", { detail: "[[" }));

    await waitForParsedData();
    if (lastParsedSheetData) {
      respondWithData();
      return;
    }
  });

  // Automatically trigger the search for the string the user mentioned.
  window.dispatchEvent(new CustomEvent("find-text-in-window", { detail: "[[" }));
})();
