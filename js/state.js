// Shared state for the 3D and 2D viewers (they always show the same thing).
import { FACTORS, START } from "./model.js";

const listeners = new Set();

export const state = {
  scenario: "ssp245",
  year: START,
  adj: Object.fromEntries(FACTORS.map((f) => [f.key, 1])),
  thermal: false,
  clouds: true,
  borders: true,
  view: "3d", // "3d" | "2d"
  focus: null, // {lat, lon} picked by the visitor
};

export function set(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state, patch));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
