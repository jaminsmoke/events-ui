import { useGit } from "./useGit";
import { useItems } from "./useItems";

/** La vista del repo: los ítems y el mapa por un lado, Git por otro.
 *
 *  Los consumidores siguen viendo un solo objeto; el refresco y las escrituras
 *  viven en el hook de su dominio. */
export function useRepo(repo: string | null) {
  return { ...useItems(repo), ...useGit(repo) };
}
