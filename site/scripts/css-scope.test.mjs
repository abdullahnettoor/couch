import assert from "node:assert/strict";
import { namespace, scope } from "./css-scope.mjs";

const css = scope(
  `:root{--a:1} body{margin:0} .x,.y:active{animation:rise .2s ease, spin 1s} @keyframes rise{from{opacity:0}} @keyframes spin{to{opacity:1}} @media (min-width:1px){.z{animation-name:rise}}`,
  ".cr",
  { active: true },
);
const out = namespace(css, "cr-");
assert.match(out, /^\.cr\{--a:1\}/);
assert.match(out, /\.cr \.x,\.cr \.y:is\(:active,\.is-active\)\{animation:cr-rise \.2s ease, cr-spin 1s\}/);
assert.match(out, /@keyframes cr-rise\{/);
assert.match(out, /@keyframes cr-spin\{/);
assert.match(out, /animation-name:cr-rise/);

const ff = namespace(`@font-face{font-family:"Foo";src:url(data:font/woff2;base64,AAAA)} .a{font-family:"Foo",sans-serif}`, "cu-");
assert.match(ff, /font-family:"cu-Foo";/);
assert.match(ff, /\.a\{font-family:"cu-Foo",sans-serif\}/);

assert.throws(() => namespace(`.a{background:url(img.png)}`, "cu-"), /unsupported url/);
assert.throws(() => namespace(`@import "x.css";`, "cu-"), /@import/);
console.log("css-scope: ok");
