export type ViewName = "home" | "property" | "map" | "list";

/** `call` = site visit at the home, `phonecall` = owner rings you, `message` = free text. */
export type ModalMode = "call" | "phonecall" | "message";

/** A file the owner says they have, described in the intake form but never uploaded. */
export interface ListingMedia {
  id: string;
  name: string;
  bytes: number;
  meta: string;
  video: boolean;
}
