import type { ApiCatalogPlace } from "./catalog";
export type CatalogPage = { dataset: string; total: number; next_offset: number | null; places: ApiCatalogPlace[] };
/** Fetch every page; never silently truncate expanded catalogs at 150. */
export async function loadCatalogPages(fetchPage: (offset: number) => Promise<CatalogPage>) {
  let offset=0, dataset="";
  const places: ApiCatalogPlace[]=[];
  const ids=new Set<string>();
  while (true) {
    const page=await fetchPage(offset);
    if (dataset && dataset!==page.dataset) throw new Error("장소 목록이 변경됐어요. 다시 시도해 주세요.");
    dataset=page.dataset;
    for (const p of page.places) {
      if (ids.has(p.place_id)) throw new Error("장소 목록에 중복이 있어요. 다시 시도해 주세요.");
      ids.add(p.place_id);places.push(p);
    }
    if (page.next_offset===null) {
      if (places.length!==page.total) throw new Error("전체 장소 목록을 받지 못했어요. 다시 시도해 주세요.");
      return {dataset,places};
    }
    if (!Number.isSafeInteger(page.next_offset) || page.next_offset<=offset || !page.places.length)
      throw new Error("장소 목록의 다음 페이지를 확인할 수 없어요.");
    offset=page.next_offset;
  }
}
