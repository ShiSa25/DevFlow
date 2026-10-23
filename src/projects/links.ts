import type { ProjectView } from "./types";

/**
 * Active is the default view and page 1 is the default page, so those values
 * stay out of the query string. Filter links call this without a page and
 * therefore return to page 1.
 */
export function projectListHref(view: ProjectView, page = 1): string {
  const params = new URLSearchParams();
  if (view === "archived") {
    params.set("view", "archived");
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query.length > 0 ? `/projects?${query}` : "/projects";
}
