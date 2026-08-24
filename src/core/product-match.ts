import type { NormalizedTarget, ProductMatchResult } from './types.ts';
import type { SearchHit } from '../providers/index.ts';
import { extractVersionTokens, normalizeModelCode, normalizeVariant } from './sku-normalization.ts';

const GENERIC_TOKENS = new Set(['제품','상품','리뷰','후기','추천','스마트','스마트tv','tv','모니터','스탠드','이동식','uhd','4k','구매','가격','공식','스토어','쇼핑','인치','형']);
function normalized(value: string | undefined): string { return (value ?? '').normalize('NFKC').toLowerCase().replace(/([0-9]+)\s*(?:inch|인치|형)/gi,'$1인치').replace(/[^0-9a-z가-힣]+/gi,' ').replace(/\s+/g,' ').trim(); }
function tokens(value: string | undefined): string[] { return normalized(value).split(' ').filter(Boolean); }
function unique<T>(values:T[]):T[]{return [...new Set(values)];}
function meaningfulNameTokens(target:NormalizedTarget):string[]{const reserved=new Set([...tokens(target.brand),...tokens(target.model),...tokens(target.variant)]);return unique(tokens(target.name).filter((t)=>!reserved.has(t)&&!GENERIC_TOKENS.has(t)));}
function hitText(hit:SearchHit):string{let decodedUrl=hit.url;try{decodedUrl=decodeURIComponent(hit.url);}catch{}return `${hit.title} ${hit.snippet} ${decodedUrl}`;}
function includesIdentity(haystack:string, needle:string|undefined, kind:'model'|'variant'|'plain'):boolean{
  if(!needle)return false;
  if(kind==='model'){const code=normalizeModelCode(needle);return Boolean(code&&normalizeModelCode(haystack).includes(code));}
  if(kind==='variant'){const value=normalizeVariant(needle);return Boolean(value&&normalizeVariant(haystack).includes(value));}
  const value=normalized(needle);return Boolean(value&&normalized(haystack).includes(value));
}

export function matchEvidenceToProduct(target: NormalizedTarget, hit: SearchHit): ProductMatchResult {
  const text=hitText(hit);
  if(target.productId&&text.includes(target.productId))return{level:'exact_product',score:1,matchedTokens:[target.productId],missingTokens:[]};
  const targetVersions=extractVersionTokens([target.model,target.variant,target.name].filter(Boolean).join(' '));
  const hitVersions=extractVersionTokens(text);
  if(targetVersions.length&&hitVersions.length&&!targetVersions.some((v)=>hitVersions.includes(v))){return{level:'unrelated',score:0,matchedTokens:[],missingTokens:targetVersions};}

  const matchedTokens:string[]=[];const missingTokens:string[]=[];let score=0;
  const brandKnown=Boolean(normalized(target.brand)),modelKnown=Boolean(normalizeModelCode(target.model)),variantKnown=Boolean(normalizeVariant(target.variant));
  const brandMatch=brandKnown&&includesIdentity(text,target.brand,'plain');
  const modelMatch=modelKnown&&includesIdentity(text,target.model,'model');
  const variantMatch=variantKnown&&includesIdentity(text,target.variant,'variant');
  if(brandKnown)(brandMatch?matchedTokens:missingTokens).push(target.brand!);if(modelKnown)(modelMatch?matchedTokens:missingTokens).push(target.model!);if(variantKnown)(variantMatch?matchedTokens:missingTokens).push(target.variant!);
  if(brandMatch)score+=0.30;if(modelMatch)score+=0.35;if(variantMatch)score+=0.20;
  const nameTokens=meaningfulNameTokens(target);if(nameTokens.length){const set=new Set(tokens(text));const matching=nameTokens.filter((t)=>set.has(t));matchedTokens.push(...matching);missingTokens.push(...nameTokens.filter((t)=>!set.has(t)));score+=0.15*(matching.length/nameTokens.length);}
  score=Math.max(0,Math.min(1,score));
  if(score>=0.80||(brandMatch&&modelMatch&&(!variantKnown||variantMatch)))return{level:'exact_product',score,matchedTokens:unique(matchedTokens),missingTokens:unique(missingTokens)};
  if(score>=0.45||(modelMatch&&(brandMatch||variantMatch)))return{level:'probable_product',score,matchedTokens:unique(matchedTokens),missingTokens:unique(missingTokens)};
  const category=tokens(target.name).filter((t)=>GENERIC_TOKENS.has(t));const hitSet=new Set(tokens(text));if(category.filter((t)=>hitSet.has(t)).length>=2)return{level:'category',score:Math.max(score,0.25),matchedTokens:unique(matchedTokens),missingTokens:unique(missingTokens)};
  return{level:'unrelated',score,matchedTokens:unique(matchedTokens),missingTokens:unique(missingTokens)};
}
