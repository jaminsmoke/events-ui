import type { UserConfigExport } from "vite";

export function presetVite(opciones: {
  puerto: number;
  ignorar?: string[];
}): UserConfigExport;
