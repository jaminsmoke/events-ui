export interface Puerta {
  id: string;
  activa?: boolean;
  motivo?: string;
}

export interface Protocolos {
  version: 1;
  puertas: Puerta[];
}

export declare const protocolos: Protocolos;
export declare const esquema: Record<string, unknown>;
export declare const PUERTAS: string[];
export declare const ARCHIVO: string;
