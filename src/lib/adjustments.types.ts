// Tipos compartidos entre el servidor y la interfaz de ajustes asistidos.
export type AdjustmentMode = "set" | "increase" | "decrease";

export interface CandidateDTO {
  id: string;
  sku: string | null;
  productName: string;
  variantLabel: string | null;
  attributes: string;
  unitSingular: string;
  unitPlural: string;
  allowsDecimal: boolean;
  unitsPerPresentation: number | null;
}

export interface ProposalDTO {
  variantId: string | null;
  locationId: string | null;
  mode: AdjustmentMode | null;
  quantity: number | null;
  reason: string;
  confidence: "alta" | "media" | "baja";
  explanation: string;
  missingInfo: string[];
}

export type ProposeResult =
  | {
      ok: true;
      proposal: ProposalDTO;
      candidates: CandidateDTO[];
      stock: Array<{ variantId: string; locationId: string; quantity: number }>;
    }
  | { ok: false; error: string; candidates: CandidateDTO[] };
