import{P as e,r,a4 as n,a2 as o}from"./sidepanel-CHT3FrHd.js";const s={reveal:{opacity:1,filter:"blur(0px)"},hidden:{opacity:0,filter:"blur(4px)"}},l=r.memo(({loading:a=!1,text:i,...t})=>e.jsx(n,{mode:"popLayout",initial:!1,children:e.jsx(o.div,{variants:s,initial:"hidden",animate:"reveal",exit:"hidden",transition:{duration:.25,type:"spring",bounce:0},...t,children:a?e.jsx(d,{text:i}):i},a?"loading":"loaded")}));l.displayName="Reveal";const d=({text:a,className:i=""})=>e.jsxs("span",{className:`inline-block shimmer-text ${i}`,style:{lineHeight:"inherit"},children:[a,e.jsx("style",{dangerouslySetInnerHTML:{__html:`
          .shimmer-text {
            color: rgba(0,0,0,0.27);
            background: linear-gradient(90deg,
              rgba(0,0,0,0.22) 0%,
              rgba(0,0,0,0.22) 50%,
              rgba(0,0,0,0.22) 54%,
              rgba(0,0,0,0.30) 57%,
              rgba(0,0,0,0.34) 61%,
              rgba(0,0,0,0.42) 66%,
              rgba(0,0,0,0.42) 74%,
              rgba(0,0,0,0.34) 79%,
              rgba(0,0,0,0.30) 83%,
              rgba(0,0,0,0.22) 88%,
              rgba(0,0,0,0.22) 92%,
              rgba(0,0,0,0.22) 100%
             );
            background-size: 200% 100%;
            background-repeat: repeat-x;
            background-clip: text;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            will-change: background-position, opacity;
            animation: shimmer-loop 1s linear infinite;
          }
          
          /* Single animation to avoid multi-animation phase drift */
          @keyframes shimmer-loop {
            0% {
              background-position: 0% 0;
              opacity: 0.98;
            }
            15% {
              opacity: 1; /* gentle ease-in */
            }
            86% {
              background-position: -200% 0; /* exactly one tile width to preserve seamlessness */
              opacity: 1;
            }
            100% {
              background-position: -202% 0; /* nudge beyond tile to move dark band entirely off before pause */
              opacity: 0.99; /* keep endpoints very close, slightly brighter to hide residual */
            }
          }
        `}})]});export{l as R,d as S};
