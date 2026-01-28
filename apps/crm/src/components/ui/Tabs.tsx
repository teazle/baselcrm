"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { useEffect, useRef } from "react";

type Tab = {
  id: string;
  label: string;
  icon?: React.ReactNode;
};

type TabsProps = {
  tabs: Tab[];
  defaultTab?: string;
  paramName?: string;
  className?: string;
  onTabChange?: (tabId: string) => void;
};

export function Tabs({
  tabs,
  defaultTab,
  paramName = "tab",
  className,
  onTabChange,
}: TabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get(paramName) || defaultTab || tabs[0]?.id;
  const tabRefs = useRef<Record<string, HTMLButtonElement>>({});

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tabId === defaultTab) {
      params.delete(paramName);
    } else {
      params.set(paramName, tabId);
    }
    router.push(`?${params.toString()}`, { scroll: false });
    onTabChange?.(tabId);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.key === "ArrowRight") {
          nextIndex = (currentIndex + 1) % tabs.length;
        } else {
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        }
        handleTabChange(tabs[nextIndex].id);
        setTimeout(() => {
          tabRefs.current[tabs[nextIndex].id]?.focus();
        }, 0);
      } else if (e.key === "Home") {
        e.preventDefault();
        handleTabChange(tabs[0].id);
        setTimeout(() => {
          tabRefs.current[tabs[0].id]?.focus();
        }, 0);
      } else if (e.key === "End") {
        e.preventDefault();
        handleTabChange(tabs[tabs.length - 1].id);
        setTimeout(() => {
          tabRefs.current[tabs[tabs.length - 1].id]?.focus();
        }, 0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tabs]);

  return (
    <div className={cn("border-b border-border", className)}>
      <div className="flex gap-1 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "relative flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type TabPanelProps = {
  id: string;
  activeTab: string;
  children: React.ReactNode;
  className?: string;
};

export function TabPanel({ id, activeTab, children, className }: TabPanelProps) {
  if (id !== activeTab) return null;

  return (
    <div
      id={`tabpanel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      className={className}
    >
      {children}
    </div>
  );
}
