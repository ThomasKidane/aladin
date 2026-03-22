import{c as o}from"./sidepanel-CHT3FrHd.js";/**
 * @license lucide-react v0.475.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]],b=o("Check",g);/**
 * @license lucide-react v0.475.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]],f=o("Copy",d),u=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),m=e=>{function c(t){const s=/(```[\S\s]*?```|`.*?`)|\\\[([\S\s]*?[^\\])\\]|\\\((.*?)\\\)/g;return t.replaceAll(s,(i,n,l,$)=>n||(l?`$$${l.trim()}$$`:$?`$${$}$`:i))}function r(t){return t.replaceAll("$\\ce{","$\\\\ce{").replaceAll("$\\pu{","$\\\\pu{")}const a=[];e=e.replace(/(```[\s\S]*?```|`[^`\n]+`)/g,(t,s)=>(a.push(s),`<<CODE_BLOCK_${a.length-1}>>`));const p=[];return e=e.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\(.*?\\\))/g,t=>(p.push(t),`<<LATEX_${p.length-1}>>`)),e=e.replace(/\$(?=\d)/g,"\\$"),e=e.replace(/<<LATEX_(\d+)>>/g,(t,s)=>p[parseInt(s)]),e=e.replace(/<<CODE_BLOCK_(\d+)>>/g,(t,s)=>a[parseInt(s)]),e=c(e),e=r(e),e},h=e=>e.replace(/([@/])\[(.*?)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,(c,r,a)=>`<span class="bg-[rgba(42,39,60,0.07)] rounded-[6px]">${r}${a}</span>`),C=e=>{const r=e.trim().split(`
`);if(r.length<3)return e;const a=r[0].trim(),p=r[r.length-1].trim(),t=a.match(/^```(\w*)$/);if(!t||p!=="```")return e;const s=t[1].toLowerCase();return s&&s!=="markdown"&&s!=="md"&&s!=="text"?e:r.slice(1,-1).join(`
`)},L=e=>e.replace(/\[tab:(\d+):text:([^\]]+)\]/g,(c,r,a)=>{try{return`[${a}](tab:${r}:text:${encodeURIComponent(a)})`}catch{return`[${a}](tab:${r}:text:${a})`}}).replace(/\[pdftab:(\d+):pdfpage:(\d+)\]/g,(c,r,a)=>`[Page ${a}](pdftab:${r}:pdfpage:${a})`).replace(/\[tab:(\d+):reload\]/g,(c,r)=>`[Tab ${r}](tab:${r}:reload)`).replace(/\[tab:(\d+)\]/g,(c,r)=>`[Tab ${r}](tab:${r})`),y=e=>h(m(u(e))),k=e=>e.replace(/\(tab:(\d+):text:([^\)]+)\)/g,(c,r,a)=>{try{return`(tab:${r}:text:${a})`}catch{return`(tab:${r}:text:${a})`}});export{b as C,f as a,m as b,h as c,k as d,L as e,y as p,C as s};
