"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleSidebar, useSidebarOpen } from "./sidebar-store";

export function SidebarToggle() {
  const open = useSidebarOpen();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={open ? "Collapse chat history" : "Expand chat history"}
      aria-pressed={open}
      title={open ? "Collapse chat history" : "Expand chat history"}
      onClick={toggleSidebar}
    >
      {open ? (
        <PanelLeftClose className="size-4" />
      ) : (
        <PanelLeftOpen className="size-4" />
      )}
    </Button>
  );
}
