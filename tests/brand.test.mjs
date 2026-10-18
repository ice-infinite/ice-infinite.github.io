import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
test('website mark uses the approved friendly medicine case, not a font glyph',async()=>{
 const logo=await readFile(new URL('assets/logo.svg',root),'utf8');
 for(const color of ['#20745B','#FFF9ED','#EDB65D']) assert.ok(logo.includes(color));
 assert.ok(logo.includes('fill-rule="evenodd"'));assert.ok(logo.includes('rotate(-34 748 425)'));
 assert.ok(!/<text|<image|<script|filter|<foreignObject/.test(logo));
});
test('local favicon and home-screen bookmark icon have the advertised dimensions',async()=>{
 for(const [file,size] of [['assets/favicon-32.png',32],['assets/apple-touch-icon.png',180]]){
  const bytes=await readFile(new URL(file,root));assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
 }
 for(const file of ['index.html','privacy.html']){
  const page=await readFile(new URL(file,root),'utf8');
  assert.ok(page.includes('assets/logo.svg'));assert.ok(page.includes('assets/favicon-32.png'));assert.ok(page.includes('assets/apple-touch-icon.png'));
 }
});
