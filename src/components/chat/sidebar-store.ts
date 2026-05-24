"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "aso-audit-sidebar-open";

type Listener = () => void;

let initialized = false;
let open = true;
const listeners = new Set<Listener>();

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved != null) return saved === "1";
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(min-width: 768px)").matches;
  }
  return true;
}

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  open = readInitial();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  ensureInitialized();
  return open;
}

function getServerSnapshot(): boolean {
  return true;
}

export function setSidebarOpen(next: boolean): void {
  ensureInitialized();
  if (open === next) return;
  open = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }
  emit();
}

export function toggleSidebar(): void {
  setSidebarOpen(!getSnapshot());
}

export function useSidebarOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
