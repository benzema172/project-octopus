/** Treat external RSS as untrusted, source-only metadata. Never render as HTML. */
function decode(value: string) {
 return value.replace(/&lt;/g,"<").replace(/&gt;/g,">")
  .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
  .replace(/&amp;/g,"&").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
}
function safeArticleUrl(value:string,host:string):string|null{
 try{
  const uri=new URL(decode(value));
  const allowed=new Set([host,"www."+host]);
  if(uri.protocol!=="https:"||!allowed.has(uri.hostname)||uri.username||uri.password)return null;
  if(uri.port&&uri.port!=="443")return null;
  uri.hash="";
  return uri.toString();
 }catch{return null;}
}
export function parseCuratedResearch(feed:string,sourceHost:string){
 const entries:Array<{url:string;title:string}>=[];
 const blocks=feed.slice(0,180000).match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi)??[];
 for(const block of blocks.slice(0,15)){
  const title=decode(block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]??"").slice(0,200);
  const link=block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i)?.[1]??
   block.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]??"";
  const url=safeArticleUrl(link,sourceHost);
  if(url&&title&&!entries.some(entry=>entry.url===url))entries.push({url,title});
 }
 return entries;
}
