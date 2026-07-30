import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import { trackEvent } from "@/lib/posthog";
import { usePrices } from "@/hooks/use-prices";

// ─── Scroll to center of viewport ───
function scrollToCenter(el: HTMLElement | null) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const elCenter = rect.top + rect.height / 2;
  const viewCenter = window.innerHeight / 2;
  window.scrollBy({ top: elCenter - viewCenter, behavior: "smooth" });
}

// ─── Count-up utility ───
function countUp(el: HTMLElement | null, target: number, duration: number) {
  if (!el) return;
  const start = performance.now();
  function tick(now: number) {
    const t = Math.min((now - start) / duration, 1);
    el!.textContent = String(Math.round(t * target));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─── useIntersectionAnimation hook ───
function useIntersectionAnimation(
  onVisible: () => void,
  threshold = 0.3,
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onVisible();
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

// ─── Status Bar SVGs (shared) ───
function StatusBarLight() {
  return (
    <div className="mlp-status-bar">
      <span>9:41</span>
      <div className="mlp-status-icons">
        <svg viewBox="0 0 18 18"><path d="M1 10h2v5H1zm4-3h2v8H5zm4-2h2v10H9zm4-3h2v13h-2z"/></svg>
        <svg viewBox="0 0 18 18"><path d="M9 2C5.7 2 2.7 3.5 1 6l1.5 1.5C4 5.5 6.4 4.5 9 4.5s5 1 6.5 3L17 6c-1.7-2.5-4.7-4-8-4zm0 5c-1.8 0-3.4.7-4.5 2L6 10.5c.8-.8 1.8-1.3 3-1.3s2.2.5 3 1.3L13.5 9C12.4 7.7 10.8 7 9 7zm0 5a2 2 0 110 4 2 2 0 010-4z"/></svg>
        <svg viewBox="0 0 24 12"><rect x="0" y="1" width="20" height="10" rx="2" fill="none" stroke="#000" strokeWidth="1.5"/><rect x="21" y="4" width="2" height="5" rx="1" fill="#000" opacity="0.4"/><rect x="2" y="3" width="14" height="6" rx="1" fill="#000"/></svg>
      </div>
    </div>
  );
}

function StatusBarDark() {
  return (
    <div className="mlp-dark-status-bar">
      <span>9:41</span>
      <div className="mlp-status-icons">
        <svg viewBox="0 0 18 18"><path d="M1 10h2v5H1zm4-3h2v8H5zm4-2h2v10H9zm4-3h2v13h-2z"/></svg>
        <svg viewBox="0 0 18 18"><path d="M9 2C5.7 2 2.7 3.5 1 6l1.5 1.5C4 5.5 6.4 4.5 9 4.5s5 1 6.5 3L17 6c-1.7-2.5-4.7-4-8-4zm0 5c-1.8 0-3.4.7-4.5 2L6 10.5c.8-.8 1.8-1.3 3-1.3s2.2.5 3 1.3L13.5 9C12.4 7.7 10.8 7 9 7zm0 5a2 2 0 110 4 2 2 0 010-4z"/></svg>
        <svg viewBox="0 0 24 12"><rect x="0" y="1" width="20" height="10" rx="2" fill="none" stroke="#fff" strokeWidth="1.5"/><rect x="21" y="4" width="2" height="5" rx="1" fill="#fff" opacity="0.4"/><rect x="2" y="3" width="14" height="6" rx="1" fill="#fff"/></svg>
      </div>
    </div>
  );
}

// ─── Link Preview Component ───
function LinkPreviewContent() {
  return (
    <>
      <div className="mlp-link-preview-img">BRANDON</div>
      <div className="mlp-link-preview-info">
        <div className="mlp-link-preview-title">Brandon AI</div>
        <div className="mlp-link-preview-domain">textbrandon.now</div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════
//  PHONE 1: iMessage Conversation
// ═══════════════════════════════════════
function IMessagePhone({ trackerRef }: { trackerRef: React.RefObject<HTMLDivElement | null> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const trackingLinkRef = useRef<HTMLDivElement>(null);
  const typingRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const screen = screenRef.current;
    if (!container || !screen) return;
    const items = container.querySelectorAll("[data-delay]");
    items.forEach((msg) => {
      const delay = parseInt((msg as HTMLElement).dataset.delay || "0");
      setTimeout(() => {
        msg.classList.add("visible");
        // Auto-scroll
        setTimeout(() => {
          const msgRect = msg.getBoundingClientRect();
          const containerRect = screen.getBoundingClientRect();
          const inputBarHeight = 72;
          const visibleBottom = containerRect.bottom - inputBarHeight;
          if (msgRect.bottom > visibleBottom) {
            const scrollBy = msgRect.bottom - visibleBottom + 12;
            screen.scrollBy({ top: scrollBy, behavior: "smooth" });
          }
        }, 50);

        // Start pulsing on tracking link
        if ((msg as HTMLElement).id === "trackingLinkRow" && trackingLinkRef.current) {
          setTimeout(() => trackingLinkRef.current?.classList.add("pulsing"), 800);
        }

        // Hide typing dots
        if ((msg as HTMLElement).dataset.hideTyping && typingRowRef.current) {
          typingRowRef.current.style.display = "none";
        }
      }, delay);
    });
  }, []);

  const handleTrackingClick = useCallback(() => {
    trackingLinkRef.current?.classList.remove("pulsing");
    scrollToCenter(trackerRef.current);
  }, [trackerRef]);

  return (
    <div className="mlp-section">
      <div className="mlp-phone-shell">
        {/* Fixed header */}
        <div className="mlp-imsg-sticky-top">
          <StatusBarLight />
          <div className="mlp-imsg-header">
            <div className="mlp-imsg-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" width="22" height="22"><path d="M15 18l-6-6 6-6"/></svg>
            </div>
            <div className="mlp-imsg-center">
              <div className="mlp-imsg-avatar"></div>
              <div className="mlp-imsg-name-row">
                <span className="mlp-imsg-name">Brandon</span>
                <span className="mlp-imsg-chevron">&rsaquo;</span>
              </div>
              <div className="mlp-imsg-sublabel">iMessage</div>
            </div>
            <div className="mlp-imsg-right">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15.6 11.8L22 7v10l-6.4-4.8z"/><rect x="1" y="5" width="15" height="14" rx="3"/></svg>
            </div>
          </div>
        </div>


        <div className="mlp-screen mlp-screen-messages" ref={screenRef}>
          <div className="mlp-chat-bg">
            <div className="mlp-messages" ref={containerRef}>
              <div className="mlp-timestamp" data-delay="0">Today 9:17 AM</div>

              <div className="mlp-bubble-row received group-first" data-delay="400">
                <div className="mlp-bubble received">Good morning! Here's today's workout 💪</div>
              </div>
              <div className="mlp-bubble-row received group-last" data-delay="1100">
                <div className="mlp-bubble received has-tail">Monday - Push Day</div>
              </div>

              <div className="mlp-link-preview-row" data-delay="2000">
                <div className="mlp-link-preview">
                  <LinkPreviewContent />
                </div>
              </div>

              <div className="mlp-bubble-row sent group-first" data-delay="3500">
                <div className="mlp-bubble sent">Wait actually I hurt my shoulder</div>
              </div>
              <div className="mlp-bubble-row sent group-last" data-delay="4200">
                <div className="mlp-bubble sent has-tail">Can we skip overhead stuff?</div>
              </div>

              <div className="mlp-delivery-status" data-delay="4800">Delivered</div>

              <div className="mlp-typing-row" data-delay="5500" ref={typingRowRef}>
                <div className="mlp-typing-indicator">
                  <div className="mlp-typing-dot"></div>
                  <div className="mlp-typing-dot"></div>
                  <div className="mlp-typing-dot"></div>
                </div>
              </div>

              <div className="mlp-bubble-row received" data-delay="7500" data-hide-typing="true">
                <div className="mlp-bubble received multiline has-tail">Sure! I swapped out the overhead press and lateral raises. Here's your updated Push Day:</div>
              </div>

              <div className="mlp-link-preview-row" data-delay="9000" id="trackingLinkRow">
                <div className="mlp-link-preview" ref={trackingLinkRef} onClick={handleTrackingClick}>
                  <LinkPreviewContent />
                </div>
              </div>

              <div className="mlp-bubble-row sent" data-delay="12000">
                <div className="mlp-bubble sent has-tail">That was fast. Thanks man 🙏</div>
              </div>

              <div className="mlp-bubble-row received" data-delay="13500">
                <div className="mlp-bubble received has-tail">Anytime! Text me when the shoulder feels better and I'll add pressing back in 💪</div>
              </div>

              <div className="mlp-scroll-hint" data-delay="15000">
                <span>This is what AI coaching looks like</span>
                <svg width="20" height="20" fill="none" stroke="#8E8E93" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14m-6-6l6 6 6-6"/></svg>
              </div>
            </div>

            <div className="mlp-input-bar">
              <div className="mlp-input-plus">+</div>
              <div className="mlp-input-field">Message</div>
              <div className="mlp-input-icons">
                <svg width="22" height="22" fill="none" stroke="#8E8E93" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <svg width="22" height="22" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 3v18M8 8v8M4 11v2M16 8v8M20 11v2"/></svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
//  PHONE 2: Workout Tracker (Dark)
// ═══════════════════════════════════════
function TrackerPhone({ progressRef }: { progressRef: React.RefObject<HTMLDivElement | null> }) {
  const controlIslandRef = useRef<HTMLDivElement>(null);
  const doneBtnRef = useRef<HTMLButtonElement>(null);

  const sectionRef = useIntersectionAnimation(() => {
    // Staggered card reveals
    const cards = sectionRef.current?.querySelectorAll("[data-tracker-delay]");
    cards?.forEach((card) => {
      const delay = parseInt((card as HTMLElement).dataset.trackerDelay || "0");
      setTimeout(() => card.classList.add("visible"), delay);
    });
    // Control island + pulsing Done button
    setTimeout(() => {
      controlIslandRef.current?.classList.add("visible");
      setTimeout(() => doneBtnRef.current?.classList.add("pulsing"), 600);
    }, 800);
  }, 0.3);

  const handleDoneClick = useCallback(() => {
    scrollToCenter(progressRef.current);
  }, [progressRef]);

  return (
    <div className="mlp-section" ref={sectionRef} id="trackerSection">
      <div className="mlp-phone-shell mlp-phone-shell-dark">
        <StatusBarDark />
        <div className="mlp-dark-tracker-header">
          <div className="mlp-dark-tracker-header-top">
            <div className="mlp-dark-tracker-title-group">
              <div className="mlp-dark-tracker-title">Push Day (Modified)</div>
              <div className="mlp-dark-tracker-subtitle">Monday</div>
            </div>
            <div className="mlp-dark-tracker-progress-num">
              <div className="mlp-dark-tracker-pct">88%</div>
              <div className="mlp-dark-tracker-sets-label">14 of 16 sets</div>
            </div>
          </div>
          <div className="mlp-dark-progress-bar">
            <div className="mlp-dark-progress-fill" style={{ width: "88%" }}></div>
          </div>
        </div>

        <div className="mlp-dark-tracker-body">
          {/* Exercise 1-4: Complete, collapsed */}
          {[
            { name: "Bench Press", plan: "4×8 · 155 lbs", count: "4/4", delay: 200 },
            { name: "Incline DB Press", plan: "3×10 · 50 lbs", count: "3/3", delay: 300 },
            { name: "Floor Press", plan: "3×10 · 115 lbs", count: "3/3", delay: 400 },
            { name: "Cable Flyes", plan: "3×12 · 25 lbs", count: "3/3", delay: 500 },
          ].map((ex) => (
            <div className="mlp-dark-exercise-card" data-tracker-delay={ex.delay} key={ex.name}>
              <div className="mlp-dark-exercise-header">
                <div className="mlp-dark-exercise-progress-bar complete"></div>
                <div className="mlp-dark-exercise-info">
                  <div className="mlp-dark-exercise-name">{ex.name}</div>
                  <div className="mlp-dark-exercise-plan">{ex.plan}</div>
                </div>
                <div className="mlp-dark-exercise-count has-progress">{ex.count}</div>
              </div>
            </div>
          ))}

          {/* Exercise 5: Tricep Pushdowns — expanded */}
          <div className="mlp-dark-exercise-card" data-tracker-delay="600">
            <div className="mlp-dark-exercise-header">
              <div className="mlp-dark-exercise-progress-bar partial" style={{ background: "linear-gradient(to bottom, #10b981 33%, #3f3f46 33%)" }}></div>
              <div className="mlp-dark-exercise-info">
                <div className="mlp-dark-exercise-name">Tricep Pushdowns</div>
                <div className="mlp-dark-exercise-plan">3×12</div>
              </div>
              <div className="mlp-dark-exercise-count has-progress">1/3</div>
            </div>
            <div className="mlp-dark-set-table">
              <div className="mlp-dark-set-row header">
                <span>Set</span><span>Previous</span><span>Weight</span><span>Reps</span><span></span>
              </div>
              {/* Set 1: done */}
              <div className="mlp-dark-set-row">
                <div className="mlp-dark-set-num done">1</div>
                <div className="mlp-dark-set-prev">40×12</div>
                <div className="mlp-dark-set-input filled">40</div>
                <div className="mlp-dark-set-input filled">12</div>
                <div className="mlp-dark-set-check checked">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                </div>
              </div>
              {/* Set 2-3: pending */}
              {[2, 3].map((n) => (
                <div className="mlp-dark-set-row" key={n}>
                  <div className="mlp-dark-set-num pending">{n}</div>
                  <div className="mlp-dark-set-prev">40×12</div>
                  <div className="mlp-dark-set-input empty">&mdash;</div>
                  <div className="mlp-dark-set-input empty">&mdash;</div>
                  <div className="mlp-dark-set-check unchecked">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Floating control island */}
        <div className="mlp-control-island" ref={controlIslandRef}>
          <div className="mlp-control-time">46:12</div>
          <div className="mlp-control-pause">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          </div>
          <button className="mlp-control-done-btn" ref={doneBtnRef} onClick={handleDoneClick}>Done</button>
          <div className="mlp-control-progress-line">
            <div className="mlp-control-progress-line-fill" style={{ width: "88%" }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
//  PHONE 3: Progress Dashboard (Dark)
// ═══════════════════════════════════════
function ProgressPhone() {
  const streakRef = useRef<HTMLSpanElement>(null);
  const workoutRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const transitionRef = useRef<HTMLDivElement>(null);

  // Build heatmap on mount
  useEffect(() => {
    const grid = heatmapRef.current;
    if (!grid || grid.children.length > 0) return;
    const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
    const workoutDays = new Set([1, 2, 4, 6]);
    const missedCells = new Set(["2-4", "5-1"]);

    for (let day = 0; day < 7; day++) {
      const label = document.createElement("div");
      label.className = "mlp-heatmap-day-label";
      label.textContent = dayLabels[day];
      grid.appendChild(label);

      for (let week = 0; week < 8; week++) {
        const cell = document.createElement("div");
        cell.className = "mlp-heatmap-cell";
        cell.dataset.week = String(week);
        cell.dataset.day = String(day);
        if (!workoutDays.has(day)) {
          cell.classList.add("rest");
        } else if (missedCells.has(week + "-" + day)) {
          cell.classList.add("missed");
        } else {
          cell.classList.add("done");
        }
        grid.appendChild(cell);
      }
    }
  }, []);

  // Build sparkline bars on mount
  const sparklineRefs = useRef<HTMLDivElement[]>([]);
  useEffect(() => {
    sparklineRefs.current.forEach((row) => {
      if (!row || row.children.length > 0) return;
      const values = row.dataset.sparkline?.split(",").map(Number) || [];
      const prIdx = row.dataset.pr ? parseInt(row.dataset.pr) : -1;
      values.forEach((v, i) => {
        const bar = document.createElement("div");
        bar.className = "mlp-sparkline-bar";
        if (i === prIdx) bar.classList.add("pr");
        bar.style.height = "0px";
        bar.dataset.targetHeight = String(Math.round((v * 32) / 100));
        row.appendChild(bar);
      });
    });
  }, []);

  const sectionRef = useIntersectionAnimation(() => {
    // Fade in transition text
    if (transitionRef.current) {
      transitionRef.current.style.transition = "opacity 0.5s ease, transform 0.5s ease";
      transitionRef.current.style.opacity = "1";
      transitionRef.current.style.transform = "translateY(0)";
    }

    // Staggered card reveals
    const body = sectionRef.current?.querySelector(".mlp-progress-body");
    body?.querySelectorAll("[data-progress-delay]").forEach((el) => {
      const delay = parseInt((el as HTMLElement).dataset.progressDelay || "0");
      setTimeout(() => el.classList.add("visible"), delay);
    });

    // Count-up: streak 0→12
    setTimeout(() => countUp(streakRef.current, 12, 1200), 300);

    // Count-up: workouts 0→47
    setTimeout(() => countUp(workoutRef.current, 47, 1400), 1400);

    // Heatmap: fade in column by column
    const cells = heatmapRef.current?.querySelectorAll(".mlp-heatmap-cell");
    cells?.forEach((cell) => {
      const week = parseInt((cell as HTMLElement).dataset.week || "0");
      const day = parseInt((cell as HTMLElement).dataset.day || "0");
      const delay = 600 + week * 80 + day * 8;
      setTimeout(() => cell.classList.add("visible"), delay);
    });

    // Sparkline bars grow
    setTimeout(() => {
      document.querySelectorAll(".mlp-sparkline-bar").forEach((bar, i) => {
        setTimeout(() => {
          (bar as HTMLElement).style.height = (bar as HTMLElement).dataset.targetHeight + "px";
        }, i * 80);
      });
    }, 900);
  }, 0.2);

  return (
    <>
      <div className="mlp-transition-text" ref={transitionRef} style={{ opacity: 0, transform: "translateY(10px)" }}>Watch your gains add up</div>
      <div className="mlp-section" ref={sectionRef} id="progressSection">
        <div className="mlp-phone-shell mlp-phone-shell-dark">
          <StatusBarDark />
          <div className="mlp-progress-header">
            <div className="mlp-progress-header-title">Progress</div>
            <div className="mlp-progress-header-subtitle">Your training overview</div>
          </div>

          <div className="mlp-progress-body">
            {/* Streak Card */}
            <div className="mlp-streak-row" data-progress-delay="200">
              <div className="mlp-streak-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 23c-3.6 0-7-2.5-7-7 0-3.2 2-6.2 4-8.2.4-.4 1.1-.2 1.2.4l.4 2.4c.1.3.4.5.7.4.2-.1.4-.3.5-.5C13.5 7.2 14.8 4 15 2c0-.5.5-.8.9-.5C19 4 21 8.5 21 12c0 6-4 11-9 11zm0-2c3.9 0 7-3.9 7-9 0-2.3-1-5-2.7-7-.6 2.5-2 5-3.8 7.5-.6.8-1.7 1.2-2.7.8-1-.4-1.6-1.3-1.7-2.3l-.1-.5C7.4 12.2 7 14 7 16c0 3.3 2.4 5 5 5z"/></svg>
              </div>
              <div className="mlp-streak-text">
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                  <span className="mlp-streak-number" ref={streakRef}>0</span>
                  <span className="mlp-streak-label">week streak</span>
                </div>
                <div className="mlp-streak-sublabel">Consecutive weeks hitting your goal</div>
              </div>
            </div>

            {/* Heatmap */}
            <div className="mlp-heatmap-section" data-progress-delay="500">
              <div className="mlp-heatmap-label">Last 8 Weeks</div>
              <div className="mlp-heatmap-grid" ref={heatmapRef}></div>
              <div className="mlp-heatmap-weeks">
                <span>8w ago</span>
                <span>This week</span>
              </div>
              <div className="mlp-heatmap-legend">
                <div className="mlp-heatmap-legend-item"><div className="mlp-heatmap-legend-swatch rest"></div>Rest</div>
                <div className="mlp-heatmap-legend-item"><div className="mlp-heatmap-legend-swatch missed"></div>Missed</div>
                <div className="mlp-heatmap-legend-item"><div className="mlp-heatmap-legend-swatch done"></div>Done</div>
              </div>
            </div>

            {/* Exercise Progress Cards */}
            {[
              { name: "Bench Press", pr: true, max: "185 lbs", trend: "12%", sparkline: "55,62,70,78,85,100", prIdx: "5", delay: 800 },
              { name: "Squat", pr: false, max: "245 lbs", trend: "8%", sparkline: "72,75,80,85,92,100", prIdx: undefined, delay: 950 },
              { name: "Deadlift", pr: true, max: "275 lbs", trend: "15%", sparkline: "58,65,72,80,88,100", prIdx: "5", delay: 1100 },
            ].map((ex, i) => (
              <div className="mlp-progress-card" data-progress-delay={ex.delay} key={ex.name}>
                <div className="mlp-progress-card-info">
                  <div className="mlp-progress-card-name">
                    {ex.name} {ex.pr && <span className="mlp-progress-card-pr">&#9733; PR</span>}
                  </div>
                  <div className="mlp-progress-card-max">Max: {ex.max}</div>
                  <div className="mlp-progress-card-trend">&#8593; {ex.trend}</div>
                </div>
                <div
                  className="mlp-sparkline-row"
                  data-sparkline={ex.sparkline}
                  data-pr={ex.prIdx}
                  ref={(el) => { if (el) sparklineRefs.current[i] = el; }}
                ></div>
              </div>
            ))}

            {/* Stats Footer */}
            <div className="mlp-progress-stats-footer" data-progress-delay="1300">
              <div className="mlp-progress-stat">
                <div className="mlp-progress-stat-num" ref={workoutRef}>0</div>
                <div className="mlp-progress-stat-label">Workouts</div>
              </div>
              <div className="mlp-progress-stat">
                <div className="mlp-progress-stat-num">3</div>
                <div className="mlp-progress-stat-label">PRs this month</div>
              </div>
              <div className="mlp-progress-stat">
                <div className="mlp-progress-stat-num">12</div>
                <div className="mlp-progress-stat-label">Week streak</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════
//  PRICING SECTION
// ═══════════════════════════════════════
function MobilePricing({ prices }: { prices: { monthlyAmount: number; yearlyAmount: number; yearlyMonthly: string; savingsPercent: number } }) {
  return (
    <section className="mlp-pricing-section" id="pricingSection">
      <p className="mlp-section-label">Simple pricing</p>
      <h2 className="mlp-section-heading">A personal trainer for the price of a coffee</h2>
      <div className="mlp-pricing-cards">
        <div className="mlp-price-card">
          <div className="mlp-price-tier">Monthly</div>
          <div className="mlp-price-amount">${prices.monthlyAmount}<span className="mlp-price-per">/mo</span></div>
          <div className="mlp-price-detail">Billed monthly</div>
          <Link href="/login" className="mlp-price-btn" onClick={() => trackEvent("cta_clicked", { location: "mobile_pricing_monthly" })}>Start free trial</Link>
        </div>
        <div className="mlp-price-card best">
          <div className="mlp-price-badge">Save {prices.savingsPercent}%</div>
          <div className="mlp-price-tier">Yearly</div>
          <div className="mlp-price-amount">${prices.yearlyMonthly}<span className="mlp-price-per">/mo</span></div>
          <div className="mlp-price-detail">${prices.yearlyAmount} billed annually</div>
          <Link href="/login" className="mlp-price-btn primary" onClick={() => trackEvent("cta_clicked", { location: "mobile_pricing_yearly" })}>Start free trial</Link>
        </div>
      </div>
      <p className="mlp-pricing-fine">7-day free trial on both plans. Cancel anytime.</p>
    </section>
  );
}

// ═══════════════════════════════════════
//  FAQ SECTION
// ═══════════════════════════════════════
const FAQ_ITEMS = [
  { q: "Is Brandon a real person?", a: "Brandon is an AI fitness coach trained on the same methods top personal trainers use. He\u2019s not a chatbot that gives generic answers. He builds real programs, tracks your progress, and adjusts your workouts based on what you tell him." },
  { q: "What if I\u2019m a complete beginner?", a: "Even better. Brandon meets you where you are. Tell him you\u2019ve never lifted a weight, and he\u2019ll start you with the basics. No judgment. No ego. Just a plan that makes sense for your level right now." },
  { q: "Do I need a gym?", a: "No. Brandon builds workouts around whatever you have. Dumbbells at home, a hotel room with nothing, a fully stocked gym \u2014 it doesn\u2019t matter. You tell him your setup and he makes it work." },
  { q: "How do I track my workouts?", a: "Brandon sends you a one-tap tracking link after every workout. It opens in your browser \u2014 looks like Strong or Hevy, but you don\u2019t have to set anything up. Just tap, log your sets, done." },
  { q: "Does Brandon text me or do I text him?", a: "Both. Brandon texts you every morning with today\u2019s workout. And you can text him anytime with questions, swaps, or updates. He\u2019s always available." },
  { q: "Can Brandon help with nutrition?", a: "Yes. Ask him about meal ideas, calorie targets, or what to eat around your workouts. He gives straightforward advice based on your goals \u2014 not a 47-page meal plan you\u2019ll never follow." },
  { q: "How is this different from a fitness app?", a: "Fitness apps give you a fixed program and hope it works. Brandon has a conversation with you. He asks questions. He adapts. He checks in. It\u2019s the difference between a vending machine and a personal trainer." },
];

function MobileFAQ({ prices }: { prices: { monthlyAmount: number; yearlyAmount: number; savingsPercent: number } }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const allFaq = [
    ...FAQ_ITEMS,
    {
      q: "What does it cost?",
      a: `$${prices.monthlyAmount} a month or $${prices.yearlyAmount} a year (save ${prices.savingsPercent}%). That\u2019s less than a single session with a personal trainer. You get unlimited texts, personalized programming, and a coach who\u2019s available 24/7. Start with a free 7-day trial.`,
    },
  ];
  return (
    <section className="mlp-faq-section" id="faqSection">
      <p className="mlp-section-label">FAQ</p>
      <h2 className="mlp-section-heading">Got questions? Good.</h2>
      <div className="mlp-faq-list">
        {allFaq.map((item, i) => (
          <div className={`mlp-faq-item ${openIndex === i ? "open" : ""}`} key={i}>
            <button className="mlp-faq-q" onClick={() => setOpenIndex(openIndex === i ? null : i)}>
              <span>{item.q}</span>
              <svg className="mlp-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div className="mlp-faq-a-wrap"><p className="mlp-faq-a">{item.a}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════
//  CTA SECTION
// ═══════════════════════════════════════
function MobileCTA() {
  return (
    <div className="mlp-section-cta">
      <p className="mlp-cta-label">Your coach is ready</p>
      <div className="mlp-cta-content">
        <h2>Stop planning.<br />Start training.</h2>
        <p>Text Brandon your goal. Get your first personalized workout in under 2 minutes.</p>
        <Link href="/login" className="mlp-cta-btn" onClick={() => trackEvent("cta_clicked", { location: "mobile_cta_footer" })}>Start your free trial &rarr;</Link>
      </div>
      <p className="mlp-cta-subtext">No app needed &middot; <strong>7 days free</strong></p>
    </div>
  );
}

// ═══════════════════════════════════════
//  FOOTER
// ═══════════════════════════════════════
function MobileFooter() {
  return (
    <footer className="mlp-site-footer">
      <div className="mlp-footer-inner">
        <span className="mlp-footer-brand">Brandon<span className="mlp-footer-dot">&middot;</span></span>
        <span className="mlp-footer-copy">&copy; 2026 Brandon AI</span>
        <span className="mlp-footer-links">
          <Link href="/legal">Legal</Link>
          <span>&middot;</span>
          <a href="mailto:support@textbrandon.now">Contact</a>
        </span>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════
function MobileLandingStyles() {
  return (
    <style>{`
  .mlp { font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .mlp *, .mlp *::before, .mlp *::after { margin: 0; padding: 0; box-sizing: border-box; }

  .mlp-landing-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 16px;
    background: #fff;
  }

  .mlp-logo-header {
    padding: 20px 20px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .mlp-logo-text { font-size: 22px; font-weight: 800; color: #111; letter-spacing: -0.5px; }
  .mlp-logo-dot { width: 7px; height: 7px; background: #34d399; border-radius: 50%; display: inline-block; margin-left: 2px; vertical-align: baseline; }
  .mlp-header-cta {
    display: inline-flex; align-items: center; gap: 6px;
    background: #2c2117; color: #faf7f2;
    padding: 10px 20px; border-radius: 99px;
    font-size: 14px; font-weight: 700;
    text-decoration: none; letter-spacing: -0.2px;
    transition: all 0.2s; white-space: nowrap;
  }
  .mlp-header-cta:hover { background: #1a1613; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(44,33,23,0.15); }
  .mlp-header-cta svg { width: 14px; height: 14px; }

  .mlp-section { display: flex; justify-content: center; padding: 0 0 40px; width: 100%; }
  .mlp-transition-text { text-align: center; padding: 32px 0; font-size: 15px; color: #52525b; letter-spacing: -0.2px; }

  /* ─── Phone Shell ─── */
  .mlp-phone-shell {
    max-width: 390px; width: 100%; aspect-ratio: 390 / 844; max-height: 90vh;
    overflow: hidden; position: relative; background: #fff;
    border-radius: 50px; border: 8px solid #1a1a1a;
    box-shadow: 0 0 0 2px #333, 0 0 0 4px #1a1a1a, 0 20px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.08);
  }
  .mlp-phone-shell-dark { background: #000; }

  .mlp-screen { position: absolute; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .mlp-screen::-webkit-scrollbar { display: none; }
  .mlp-screen-messages { z-index: 1; top: 120px; }

  /* ─── Hero Headline ─── */
  .mlp-hero-headline { text-align: center; padding: 40px 24px 20px; max-width: 600px; margin: 0 auto; }
  .mlp-hero-headline h1 { font-size: 32px; font-weight: 700; color: #111; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 16px; }
  .mlp-hero-headline p { font-size: 16px; color: #52525b; line-height: 1.5; margin: 0; }

  /* ─── iMessage Header ─── */
  .mlp-imsg-sticky-top {
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    background: #fff; border-bottom: 0.5px solid rgba(0,0,0,0.12); border-radius: 42px 42px 0 0;
  }
  .mlp-status-bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px 8px; font-size: 16px; font-weight: 700; color: #000; }
  .mlp-status-icons { display: flex; gap: 5px; align-items: center; }
  .mlp-status-icons svg { width: 18px; height: 18px; fill: #000; }
  .mlp-dark-status-bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px 8px; font-size: 16px; font-weight: 700; color: #fff; }
  .mlp-dark-status-bar .mlp-status-icons svg { fill: #fff; }

  .mlp-imsg-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 16px 10px; }
  .mlp-imsg-left { min-width: 50px; }
  .mlp-imsg-center { display: flex; flex-direction: column; align-items: center; gap: 1px; }
  .mlp-imsg-avatar { width: 32px; height: 32px; border-radius: 50%; background: #34A853; flex-shrink: 0; }
  .mlp-imsg-name-row { display: flex; align-items: center; gap: 2px; }
  .mlp-imsg-name { font-size: 13px; font-weight: 600; color: #000; }
  .mlp-imsg-chevron { color: #8E8E93; font-size: 13px; font-weight: 400; }
  .mlp-imsg-sublabel { font-size: 11px; color: #8E8E93; font-weight: 400; }
  .mlp-imsg-right { min-width: 50px; display: flex; justify-content: flex-end; cursor: pointer; }


  /* ─── Chat Area ─── */
  .mlp-chat-bg { background: #FFFFFF; min-height: 100%; }
  .mlp-messages { padding: 12px 16px; display: flex; flex-direction: column; padding-bottom: 20px; }
  .mlp-timestamp { text-align: center; font-size: 12px; color: #8E8E93; margin: 14px 0 8px; font-weight: 500; opacity: 0; transform: translateY(10px); }
  .mlp-timestamp.visible { animation: mlp-bubble-in 0.4s ease forwards; }

  /* ─── Bubbles ─── */
  .mlp-bubble-row { display: flex; opacity: 0; transform: translateY(10px); margin-top: 6px; }
  .mlp-bubble-row.visible { animation: mlp-bubble-in 0.4s ease forwards; }
  .mlp-bubble-row.sent { justify-content: flex-end; }
  .mlp-bubble-row.received { justify-content: flex-start; }
  .mlp-bubble-row.sent + .mlp-bubble-row.sent,
  .mlp-bubble-row.received + .mlp-bubble-row.received { margin-top: 2px; }

  .mlp-bubble {
    max-width: 255px; padding: 6px 16px; font-size: 17px; line-height: 22px;
    border-radius: 16px; word-wrap: break-word; min-height: 32px;
    display: flex; align-items: center; position: relative;
  }
  .mlp-bubble.multiline { display: block; padding-top: 8px; padding-bottom: 8px; }
  .mlp-bubble.sent { background: #007AFF; color: #FFFFFF; }
  .mlp-bubble.received { background: #E5E5EA; color: #000000; }

  /* Bubble Grouping */
  .mlp-bubble-row.sent.group-first .mlp-bubble.sent { border-bottom-right-radius: 4px; }
  .mlp-bubble-row.sent.group-mid .mlp-bubble.sent { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
  .mlp-bubble-row.sent.group-last .mlp-bubble.sent { border-top-right-radius: 4px; }
  .mlp-bubble-row.received.group-first .mlp-bubble.received { border-bottom-left-radius: 4px; }
  .mlp-bubble-row.received.group-mid .mlp-bubble.received { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
  .mlp-bubble-row.received.group-last .mlp-bubble.received { border-top-left-radius: 4px; }

  /* Bubble Tails */
  .mlp-bubble.has-tail { overflow: visible; }
  .mlp-bubble.sent.has-tail::after {
    content: ''; position: absolute; bottom: 0; right: -6px; width: 10px; height: 16px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='16'%3E%3Cpath d='M0 0 Q0 16 10 16 Q4 16 0 10 Z' fill='%23007AFF'/%3E%3C/svg%3E");
    background-size: contain; background-repeat: no-repeat;
  }
  .mlp-bubble.received.has-tail::after {
    content: ''; position: absolute; bottom: 0; left: -6px; width: 10px; height: 16px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='16'%3E%3Cpath d='M10 0 Q10 16 0 16 Q6 16 10 10 Z' fill='%23E5E5EA'/%3E%3C/svg%3E");
    background-size: contain; background-repeat: no-repeat;
  }

  /* Delivery Status */
  .mlp-delivery-status { text-align: right; font-size: 11px; color: #8E8E93; margin-top: 2px; padding-right: 4px; opacity: 0; }
  .mlp-delivery-status.visible { animation: mlp-bubble-in 0.3s ease forwards; }

  /* Typing Indicator */
  .mlp-typing-row { display: flex; justify-content: flex-start; margin-top: 6px; opacity: 0; transform: translateY(10px); }
  .mlp-typing-row.visible { animation: mlp-bubble-in 0.3s ease forwards; }
  .mlp-typing-indicator { display: flex; align-items: center; gap: 5px; padding: 10px 16px; background: #E5E5EA; border-radius: 16px; width: fit-content; animation: mlp-typing-bulge 2s ease-in-out infinite; }
  .mlp-typing-dot { width: 8px; height: 8px; background: #9E9EA1; border-radius: 50%; animation: mlp-typing-blink 1s infinite; }
  .mlp-typing-dot:nth-child(2) { animation-delay: 0.33s; }
  .mlp-typing-dot:nth-child(3) { animation-delay: 0.66s; }

  @keyframes mlp-typing-blink { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
  @keyframes mlp-typing-bulge { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }

  /* ─── Link Preview ─── */
  .mlp-link-preview-row { display: flex; justify-content: flex-start; margin-top: 2px; opacity: 0; transform: translateY(10px); }
  .mlp-link-preview-row.visible { animation: mlp-bubble-in 0.4s ease forwards; }
  .mlp-link-preview {
    display: block; width: 300px; border-radius: 16px; overflow: hidden;
    text-decoration: none; cursor: pointer; transition: all 0.2s; position: relative;
  }
  .mlp-link-preview-img { width: 100%; height: 90px; background: #000; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-size: 20px; font-weight: 800; letter-spacing: 3px; }
  .mlp-link-preview-info { background: #1C1C1E; padding: 10px 12px; }
  .mlp-link-preview-title { color: #FFFFFF; font-size: 14px; font-weight: 600; margin-bottom: 2px; }
  .mlp-link-preview-domain { color: #8E8E93; font-size: 12px; }
  .mlp-link-preview.pulsing { animation: mlp-link-pulse 2s ease-in-out infinite; }
  @keyframes mlp-link-pulse {
    0% { box-shadow: 0 0 0 0 rgba(0,122,255,0.4); }
    50% { box-shadow: 0 0 0 8px rgba(0,122,255,0), 0 0 20px 2px rgba(0,122,255,0.15); }
    100% { box-shadow: 0 0 0 0 rgba(0,122,255,0); }
  }

  /* Scroll Hint */
  .mlp-scroll-hint { text-align: center; padding: 20px 24px 8px; font-size: 12px; color: #8E8E93; display: flex; flex-direction: column; align-items: center; gap: 6px; opacity: 0; }
  .mlp-scroll-hint.visible { animation: mlp-bubble-in 0.5s ease forwards; }
  .mlp-scroll-hint svg { animation: mlp-bounce 2s ease-in-out infinite; }

  /* Input Bar */
  .mlp-input-bar {
    position: sticky; bottom: 0; background: rgba(255,255,255,0.95);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    padding: 8px 12px 34px; display: flex; align-items: center; gap: 8px;
    border-top: 0.5px solid rgba(0,0,0,0.1);
  }
  .mlp-input-plus { width: 30px; height: 30px; border-radius: 50%; background: #E9E9EB; display: flex; align-items: center; justify-content: center; color: #8E8E93; font-size: 20px; flex-shrink: 0; }
  .mlp-input-field { flex: 1; background: transparent; border: 1px solid #C7C7CC; border-radius: 18px; padding: 7px 16px; color: #C7C7CC; font-size: 17px; }
  .mlp-input-icons { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

  /* ═══════════════════════════════════════
     DARK TRACKER
     ═══════════════════════════════════════ */
  .mlp-dark-tracker-header { padding: 8px 20px 16px; border-bottom: 0.5px solid rgba(255,255,255,0.08); }
  .mlp-dark-tracker-header-top { display: flex; align-items: flex-start; justify-content: space-between; }
  .mlp-dark-tracker-title-group { flex: 1; }
  .mlp-dark-tracker-title { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
  .mlp-dark-tracker-subtitle { font-size: 13px; color: #a1a1aa; margin-top: 2px; }
  .mlp-dark-tracker-progress-num { text-align: right; }
  .mlp-dark-tracker-pct { font-size: 28px; font-weight: 800; color: #fff; font-family: 'SF Mono', 'Menlo', monospace; line-height: 1; }
  .mlp-dark-tracker-sets-label { font-size: 11px; color: #a1a1aa; margin-top: 2px; }
  .mlp-dark-progress-bar { margin-top: 14px; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; position: relative; }
  .mlp-dark-progress-fill { height: 100%; width: 33%; background: #10b981; border-radius: 2px; box-shadow: 0 0 12px rgba(16,185,129,0.4); transition: width 1.5s cubic-bezier(0.16, 1, 0.3, 1); }

  /* Exercise Cards */
  .mlp-dark-tracker-body { padding: 16px 16px 120px; display: flex; flex-direction: column; gap: 10px; }
  .mlp-dark-exercise-card {
    background: rgba(255,255,255,0.06); border-radius: 14px; overflow: hidden;
    border: 0.5px solid rgba(255,255,255,0.06); opacity: 0; transform: translateY(12px);
  }
  .mlp-dark-exercise-card.visible { animation: mlp-bubble-in 0.4s ease forwards; }
  .mlp-dark-exercise-header { display: flex; align-items: center; padding: 14px 16px; gap: 12px; }
  .mlp-dark-exercise-progress-bar { width: 3px; height: 36px; border-radius: 2px; flex-shrink: 0; }
  .mlp-dark-exercise-progress-bar.complete { background: #10b981; }
  .mlp-dark-exercise-progress-bar.partial { background: linear-gradient(to bottom, #10b981 66%, #3f3f46 66%); }
  .mlp-dark-exercise-progress-bar.pending { background: #3f3f46; }
  .mlp-dark-exercise-info { flex: 1; }
  .mlp-dark-exercise-name { font-size: 15px; font-weight: 600; color: #fff; }
  .mlp-dark-exercise-plan { font-size: 12px; color: #71717a; margin-top: 1px; }
  .mlp-dark-exercise-count { font-size: 14px; font-weight: 600; color: #a1a1aa; font-family: 'SF Mono', 'Menlo', monospace; }
  .mlp-dark-exercise-count.has-progress { color: #10b981; }

  /* Set Table */
  .mlp-dark-set-table { padding: 0 16px 12px; }
  .mlp-dark-set-row { display: grid; grid-template-columns: 32px 1fr 1fr 1fr 32px; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 0.5px solid rgba(255,255,255,0.04); }
  .mlp-dark-set-row:last-child { border-bottom: none; }
  .mlp-dark-set-row.header { font-size: 9px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; padding: 6px 0; }
  .mlp-dark-set-num { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: 'SF Mono', 'Menlo', monospace; }
  .mlp-dark-set-num.done { background: #10b981; color: #fff; }
  .mlp-dark-set-num.pending { background: rgba(255,255,255,0.06); color: #71717a; }
  .mlp-dark-set-prev { font-size: 12px; color: #52525b; text-align: center; font-family: 'SF Mono', 'Menlo', monospace; }
  .mlp-dark-set-input { background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 7px 8px; color: #fff; font-size: 14px; font-weight: 500; text-align: center; font-family: 'SF Mono', 'Menlo', monospace; }
  .mlp-dark-set-input.filled { background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.15); color: #fff; }
  .mlp-dark-set-input.empty { color: #3f3f46; }
  .mlp-dark-set-check { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .mlp-dark-set-check.checked { background: #10b981; }
  .mlp-dark-set-check.unchecked { border: 2px solid #3f3f46; }

  /* Control Island */
  .mlp-control-island {
    position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%);
    background: rgba(30,30,30,0.95); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-radius: 24px; padding: 12px 20px; display: flex; align-items: center; gap: 16px;
    border: 0.5px solid rgba(255,255,255,0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    opacity: 0; transform: translateX(-50%) translateY(12px);
  }
  .mlp-control-island.visible { animation: mlp-island-in 0.5s ease forwards; }
  @keyframes mlp-island-in { to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  .mlp-control-time { font-size: 18px; font-weight: 700; color: #fff; font-family: 'SF Mono', 'Menlo', monospace; letter-spacing: 1px; }
  .mlp-control-pause { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .mlp-control-done-btn { background: #10b981; color: #fff; font-size: 15px; font-weight: 700; padding: 10px 24px; border-radius: 16px; border: none; cursor: pointer; letter-spacing: -0.2px; }
  .mlp-control-progress-line { position: absolute; bottom: 0; left: 20px; right: 20px; height: 2px; background: rgba(255,255,255,0.06); border-radius: 1px; }
  .mlp-control-progress-line-fill { height: 100%; width: 33%; background: #10b981; border-radius: 1px; }

  @keyframes mlp-done-pulse {
    0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
    50% { box-shadow: 0 0 0 10px rgba(16,185,129,0), 0 0 24px 3px rgba(16,185,129,0.18); }
    100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
  }
  .mlp-control-done-btn.pulsing { animation: mlp-done-pulse 2s ease-in-out infinite; }

  /* ═══════════════════════════════════════
     PROGRESS PHONE
     ═══════════════════════════════════════ */
  .mlp-progress-header { padding: 8px 20px 16px; border-bottom: 0.5px solid rgba(255,255,255,0.08); }
  .mlp-progress-header-title { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
  .mlp-progress-header-subtitle { font-size: 13px; color: #a1a1aa; margin-top: 2px; }
  .mlp-progress-body { overflow-y: auto; position: absolute; inset: 0; top: 96px; padding: 16px 16px 40px; display: flex; flex-direction: column; gap: 14px; }
  .mlp-progress-body::-webkit-scrollbar { display: none; }

  /* Streak */
  .mlp-streak-row { display: flex; align-items: center; gap: 14px; padding: 16px; background: rgba(255,255,255,0.06); border-radius: 14px; border: 0.5px solid rgba(255,255,255,0.06); opacity: 0; transform: translateY(12px); }
  .mlp-streak-row.visible { animation: mlp-bubble-in 0.4s ease forwards; }
  .mlp-streak-icon { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #f97316, #ea580c); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .mlp-streak-text { flex: 1; }
  .mlp-streak-number { font-size: 32px; font-weight: 800; color: #fff; line-height: 1; font-family: 'SF Mono', 'Menlo', monospace; }
  .mlp-streak-label { font-size: 14px; font-weight: 600; color: #a1a1aa; margin-top: 2px; }
  .mlp-streak-sublabel { font-size: 11px; color: #71717a; margin-top: 2px; }

  /* Heatmap */
  .mlp-heatmap-section { opacity: 0; transform: translateY(12px); }
  .mlp-heatmap-section.visible { animation: mlp-bubble-in 0.4s ease forwards; }
  .mlp-heatmap-label { font-size: 9px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }
  .mlp-heatmap-grid { display: grid; grid-template-columns: 16px repeat(8, 1fr); gap: 3px; }
  .mlp-heatmap-day-label { font-size: 8px; color: #52525b; display: flex; align-items: center; justify-content: flex-end; padding-right: 2px; }
  .mlp-heatmap-cell { aspect-ratio: 1; border-radius: 3px; opacity: 0; transition: opacity 0.3s ease; }
  .mlp-heatmap-cell.visible { opacity: 1; }
  .mlp-heatmap-cell.done { background: #34d399; }
  .mlp-heatmap-cell.missed { background: transparent; border: 1px solid #52525b; }
  .mlp-heatmap-cell.rest { background: rgba(63,63,70,0.4); }
  .mlp-heatmap-legend { display: flex; gap: 12px; margin-top: 8px; font-size: 9px; color: #71717a; }
  .mlp-heatmap-legend-item { display: flex; align-items: center; gap: 4px; }
  .mlp-heatmap-legend-swatch { width: 8px; height: 8px; border-radius: 2px; }
  .mlp-heatmap-legend-swatch.done { background: #34d399; }
  .mlp-heatmap-legend-swatch.missed { border: 1px solid #52525b; }
  .mlp-heatmap-legend-swatch.rest { background: rgba(63,63,70,0.4); }
  .mlp-heatmap-weeks { display: flex; justify-content: space-between; padding-left: 19px; margin-top: 4px; font-size: 8px; color: #52525b; }

  /* Progress Cards */
  .mlp-progress-card { background: rgba(255,255,255,0.06); border-radius: 14px; padding: 14px 16px; border: 0.5px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 12px; opacity: 0; transform: translateY(12px); }
  .mlp-progress-card.visible { animation: mlp-bubble-in 0.4s ease forwards; }
  .mlp-progress-card-info { flex: 1; }
  .mlp-progress-card-name { font-size: 15px; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 8px; }
  .mlp-progress-card-pr { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; padding: 2px 6px; border-radius: 4px; }
  .mlp-progress-card-max { font-size: 12px; color: #71717a; margin-top: 2px; }
  .mlp-progress-card-trend { font-size: 12px; font-weight: 600; color: #34d399; }
  .mlp-sparkline-row { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
  .mlp-sparkline-bar { width: 6px; border-radius: 2px; background: #10b981; transition: height 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
  .mlp-sparkline-bar.pr { background: #f59e0b; }

  /* Stats Footer */
  .mlp-progress-stats-footer { display: flex; justify-content: space-around; padding: 14px 0; border-top: 0.5px solid rgba(255,255,255,0.06); opacity: 0; transform: translateY(12px); }
  .mlp-progress-stats-footer.visible { animation: mlp-bubble-in 0.4s ease forwards; }
  .mlp-progress-stat { text-align: center; }
  .mlp-progress-stat-num { font-size: 20px; font-weight: 800; color: #fff; font-family: 'SF Mono', 'Menlo', monospace; }
  .mlp-progress-stat-label { font-size: 10px; color: #71717a; margin-top: 2px; }

  /* ═══════════════════════════════════════
     PRICING
     ═══════════════════════════════════════ */
  .mlp-pricing-section { padding: 80px 24px 60px; width: 100%; margin: 0 auto; background: #faf7f2; border-radius: 32px; }
  .mlp-section-label { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #10b981; text-align: center; margin: 0 0 12px; }
  .mlp-section-heading { font-size: 28px; font-weight: 800; color: #2c2117; text-align: center; letter-spacing: -1px; margin: 0 0 40px; line-height: 1.1; }
  .mlp-pricing-cards { display: flex; flex-direction: column; align-items: center; gap: 20px; justify-content: center; max-width: 700px; margin: 0 auto; }
  .mlp-price-card { background: #fff; border-radius: 20px; padding: 36px 32px; color: #2c2117; max-width: 100%; width: 100%; position: relative; border: 1px solid #e8e2d9; text-align: left; transition: box-shadow 0.2s; }
  .mlp-price-card:hover { box-shadow: 0 8px 30px rgba(44,33,23,0.08); }
  .mlp-price-card.best { border: 1.5px solid #10b981; box-shadow: 0 8px 30px rgba(16,185,129,0.1); }
  .mlp-price-badge { position: absolute; top: -12px; right: 20px; background: #10b981; color: #fff; border-radius: 99px; font-size: 12px; font-weight: 700; padding: 4px 14px; letter-spacing: 0.3px; }
  .mlp-price-tier { font-size: 15px; font-weight: 600; color: #78716c; margin-bottom: 8px; }
  .mlp-price-amount { font-size: 48px; font-weight: 800; color: #2c2117; line-height: 1; margin-bottom: 4px; letter-spacing: -2px; }
  .mlp-price-per { font-size: 18px; font-weight: 500; color: #a8a29e; letter-spacing: 0; }
  .mlp-price-detail { font-size: 14px; color: #a8a29e; margin-bottom: 24px; }
  .mlp-price-btn { display: block; text-align: center; padding: 14px 24px; border-radius: 99px; font-size: 15px; font-weight: 700; text-decoration: none; transition: all 0.2s; letter-spacing: -0.2px; border: 1.5px solid #d6d0c8; color: #2c2117; }
  .mlp-price-btn:hover { border-color: #2c2117; background: #faf7f2; }
  .mlp-price-btn.primary { background: #10b981; color: #fff; border: none; }
  .mlp-price-btn.primary:hover { background: #059669; }
  .mlp-pricing-fine { text-align: center; font-size: 14px; color: #a8a29e; margin-top: 24px; }

  /* ═══════════════════════════════════════
     FAQ
     ═══════════════════════════════════════ */
  .mlp-faq-section { padding: 60px 24px 80px; width: 100%; max-width: 900px; margin: 0 auto; }
  .mlp-faq-list { max-width: 700px; margin: 0 auto; }
  .mlp-faq-item { border-bottom: 1px solid #e8e2d9; }
  .mlp-faq-q { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 20px 0; background: none; border: none; cursor: pointer; font-size: 17px; font-weight: 600; color: #2c2117; text-align: left; font-family: inherit; gap: 16px; }
  .mlp-faq-chevron { width: 20px; height: 20px; flex-shrink: 0; transition: transform 0.3s ease; color: #a8a29e; }
  .mlp-faq-item.open .mlp-faq-chevron { transform: rotate(180deg); }
  .mlp-faq-a-wrap { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
  .mlp-faq-item.open .mlp-faq-a-wrap { max-height: 200px; }
  .mlp-faq-a { color: #52525b; font-size: 15px; line-height: 1.6; padding: 0 0 20px; margin: 0; }

  /* ═══════════════════════════════════════
     CTA
     ═══════════════════════════════════════ */
  .mlp-section-cta { background: #faf7f2; padding: 60px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; position: relative; border-radius: 32px 32px 0 0; width: 100%; }
  .mlp-cta-label { font-size: 14px; font-weight: 600; color: #10b981; margin-bottom: 16px; letter-spacing: 0.02em; }
  .mlp-cta-content h2 { font-size: 36px; font-weight: 800; line-height: 1.05; letter-spacing: -1px; color: #2c2117; margin-bottom: 16px; }
  .mlp-cta-content p { color: #78716c; font-size: 16px; line-height: 1.6; margin-bottom: 36px; max-width: 420px; }
  .mlp-cta-btn { display: inline-flex; align-items: center; gap: 8px; background: #2c2117; color: #faf7f2; padding: 16px 36px; border-radius: 99px; font-size: 17px; font-weight: 700; text-decoration: none; transition: all 0.2s; letter-spacing: -0.2px; }
  .mlp-cta-btn:hover { background: #1a1613; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(44,33,23,0.15); }
  .mlp-cta-subtext { margin-top: 24px; font-size: 14px; color: #a8a29e; }
  .mlp-cta-subtext strong { color: #78716c; font-weight: 600; }

  /* ═══════════════════════════════════════
     FOOTER
     ═══════════════════════════════════════ */
  .mlp-site-footer { background: #f5f0eb; display: flex; justify-content: space-between; align-items: center; padding: 32px 24px; color: #a8a29e; font-size: 14px; width: 100%; }
  .mlp-footer-inner { display: flex; flex-direction: column; gap: 8px; text-align: center; align-items: center; max-width: 900px; width: 100%; margin: 0 auto; }
  .mlp-footer-brand { font-weight: 800; color: #2c2117; font-size: 18px; letter-spacing: -0.5px; }
  .mlp-footer-dot { color: #10b981; }
  .mlp-footer-links a { color: #a8a29e; text-decoration: none; transition: color 0.2s; }
  .mlp-footer-links a:hover { color: #2c2117; }

  /* ─── Animations ─── */
  @keyframes mlp-bubble-in { to { opacity: 1; transform: translateY(0); } }
  @keyframes mlp-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(4px); } }
    `}</style>
  );
}

// ═══════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════
export default function MobileLanding() {
  const trackerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const prices = usePrices();

  // Attach refs via ID after mount
  useEffect(() => {
    trackerRef.current = document.getElementById("trackerSection") as HTMLDivElement;
    progressRef.current = document.getElementById("progressSection") as HTMLDivElement;
  }, []);

  return (
    <div className="mlp">
      <MobileLandingStyles />
      <div className="mlp-landing-page">
        <div className="mlp-logo-header">
          <div className="mlp-logo">
            <span className="mlp-logo-text">Brandon</span><span className="mlp-logo-dot"></span>
          </div>
          <Link href="/login" className="mlp-header-cta" onClick={() => trackEvent("cta_clicked", { location: "mobile_header" })}>
            Start Now
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></svg>
          </Link>
        </div>

        <div className="mlp-hero-headline">
          <h1>Let AI manage your fitness routine</h1>
          <p>Personalized workouts, texted daily. No app needed.</p>
        </div>

        <IMessagePhone trackerRef={trackerRef} />

        <div className="mlp-transition-text">One tap to start tracking</div>

        <TrackerPhone progressRef={progressRef} />

        <ProgressPhone />

        <MobilePricing prices={prices} />
        <MobileFAQ prices={prices} />
        <MobileCTA />
        <MobileFooter />
      </div>
    </div>
  );
}
