import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function ServerPagination({ page, pageSize, total, pathname, query = {} }: { page:number; pageSize:number; total:number; pathname:string; query?:Record<string,string|number|undefined> }) {
  const pages=Math.max(1,Math.ceil(total/pageSize));
  if(pages<=1)return null;
  const href=(target:number)=>{const params=new URLSearchParams();for(const[key,value]of Object.entries(query))if(value!==undefined)params.set(key,String(value));params.set("page",String(target));return `${pathname}?${params.toString()}`;};
  return <nav className="server-pagination" aria-label="Stronicowanie"><Link className={`secondary-button${page<=1?" is-disabled":""}`} aria-disabled={page<=1} href={page<=1?href(1):href(page-1)}><ChevronLeft size={14}/>Poprzednia</Link><span>Strona <strong>{page}</strong> z <strong>{pages}</strong> · {total} rekordów</span><Link className={`secondary-button${page>=pages?" is-disabled":""}`} aria-disabled={page>=pages} href={page>=pages?href(pages):href(page+1)}>Następna<ChevronRight size={14}/></Link></nav>;
}
