import { useEffect, useRef, useState } from 'react';

/**
 * Per-page table-of-contents navigation. Renders a sticky pill at
 * the top of the page that shows the currently-visible section
 * label; tapping it expands a vertical dropdown of every section.
 * Tapping a section smooth-scrolls to it.
 *
 * Why a vertical dropdown rather than a horizontal pill row across
 * the top: with 8+ sections (Settings) a horizontal row would force
 * the user to scroll side-to-side to see every section — the exact
 * complaint that motivated this PR. A collapsible vertical menu
 * scales to any number of sections without horizontal scroll, works
 * equally well on phone portrait and desktop, and clears once the
 * user picks a target so it never blocks the page content.
 *
 * Active section detection uses IntersectionObserver. The "active"
 * section is the topmost one currently intersecting the viewport
 * after subtracting the sticky-header offset — so the pill label
 * tracks what the user is reading as they scroll, and the picker
 * highlights it when expanded.
 *
 * Mounted by individual pages (Settings, ProjectPage, Reports). The
 * Dashboard and Workboards list pages have a single primary section
 * each so they don't need a TOC.
 */

export interface PageTOCItem {
  /** Must match the `id` attribute on the corresponding section element. */
  id: string;
  /** User-visible label in the picker and the active-pill button. */
  label: string;
  /** Optional emoji prefix to make the picker more scannable. */
  icon?: string;
}

interface Props {
  items: PageTOCItem[];
  /**
   * Pixels to subtract when scrolling to a section, to clear the
   * sticky app header. Default 80 covers the header (~52px) plus
   * a little breathing room. Pages can override if they have
   * additional sticky chrome above the content.
   */
  scrollOffset?: number;
}

export default function PageTOC({ items, scrollOffset = 80 }: Props) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Listener attached only while open so we
  // don't churn event handlers during normal scrolling.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  // Close on Escape — standard accessibility behavior for any
  // expandable menu.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Track active section via IntersectionObserver. Each section
  // observed independently so we can reason about "is it currently
  // visible" without a global scroll listener.
  //
  // Active = first item (in the page's original section order) that
  // is currently intersecting the viewport, after subtracting the
  // sticky header from the top. The bottom rootMargin of -50% means
  // a section becomes "active" as soon as it crosses the upper half
  // of the viewport — feels like a natural "now reading this" cue
  // without flickering between sections at the boundary.
  useEffect(() => {
    if (items.length === 0) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // First visible in original item order wins.
        for (const item of items) {
          if (visible.has(item.id)) {
            setActiveId(item.id);
            return;
          }
        }
      },
      {
        rootMargin: `-${scrollOffset}px 0px -50% 0px`,
        threshold: 0,
      },
    );
    const observed: Element[] = [];
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) {
        observer.observe(el);
        observed.push(el);
      }
    }
    return () => {
      observed.forEach((el) => observer.unobserve(el));
      observer.disconnect();
    };
  }, [items, scrollOffset]);

  function jumpTo(e: React.MouseEvent, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - scrollOffset;
    window.scrollTo({ top, behavior: 'smooth' });
    setOpen(false);
    // Optimistic active update — IntersectionObserver will catch up
    // a frame later once the smooth-scroll lands, but the user gets
    // immediate visual feedback that their pick took effect.
    setActiveId(id);
  }

  if (items.length === 0) return null;

  const activeItem = items.find((i) => i.id === activeId) ?? items[0];

  return (
    <div
      ref={containerRef}
      // sticky top-14 = pinned just below the app header (which is
      // ~52px tall at sm: breakpoint, slightly less on mobile). The
      // negative horizontal margin + matching px-4 makes the pill
      // bleed to the page edges on small screens for more tap room
      // while still aligning with the page content's gutter.
      className="sticky top-14 z-20 -mx-4 px-4 mb-3 sm:mx-0 sm:px-0"
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-white shadow-sm text-sm transition ${
            open
              ? 'border-brand-500 ring-2 ring-brand-100'
              : 'border-slate-200 hover:border-slate-300'
          }`}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`Jump to section. Currently viewing: ${activeItem.label}`}
          title={
            open
              ? 'Close the section picker'
              : `Jump to a section — currently viewing ${activeItem.label}`
          }
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400">📍</span>
            <span className="text-slate-500 text-xs uppercase tracking-wide hidden sm:inline">
              Jump to
            </span>
            <span className="font-medium text-slate-700 truncate">
              {activeItem.icon && (
                <span className="mr-1">{activeItem.icon}</span>
              )}
              {activeItem.label}
            </span>
          </span>
          <span className="text-slate-400 shrink-0">{open ? '▴' : '▾'}</span>
        </button>

        {open && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-[60vh] overflow-y-auto py-1"
          >
            {items.map((it) => {
              const isActive = it.id === activeId;
              return (
                <li key={it.id}>
                  <a
                    href={`#${it.id}`}
                    onClick={(e) => jumpTo(e, it.id)}
                    className={`block px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                    role="option"
                    aria-selected={isActive}
                  >
                    {it.icon && <span className="mr-2">{it.icon}</span>}
                    {it.label}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
