import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { signupProgressApi } from "@/lib/api";
import { trackEvent } from "@/lib/posthog";
import { usePrices } from "@/hooks/use-prices";
import MobileLanding from "./mobile-landing";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Flame,
} from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const prices = usePrices();

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) {
      signupProgressApi
        .get()
        .then((progress) => {
          if (progress.signupStage === "complete") setLocation("/dashboard");
          else if (progress.signupStage === "payment_pending") setLocation("/payment");
          else if (progress.signupStage === "plan_pending") setLocation("/setup-plan");
          else if (progress.signupStage === "onboarding_incomplete") setLocation("/onboarding");
        })
        .catch(() => {});
    }
  }, [isAuthenticated, authLoading, setLocation]);

  if (isMobile) return <MobileLanding />;

  return (
    <div className="lp">
      <LandingStyles />
      <Nav />
      <Hero prices={prices} />
      <LogoStrip />
      <HowItWorks />
      <Results />
      <SocialProof />
      <Pricing prices={prices} />
      <FinalCTA />
      <FAQ prices={prices} />
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════
   NAV
   ═══════════════════════════════════════════ */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <nav className={`lp-nav${scrolled ? " scrolled" : ""}`}>
      <Link href="/" className="lp-logo">
        Brandon<span className="lp-dot" />
      </Link>
      <div className="lp-nav-links">
        <a href="#how" className="lp-nav-link">How it works</a>
        <a href="#pricing" className="lp-nav-link">Pricing</a>
        <Link href="/login" className="lp-nav-cta" onClick={() => trackEvent('cta_clicked', { location: 'nav' })}>
          Get started <ArrowRight size={14} />
        </Link>
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════
   HERO — split layout with phone
   ═══════════════════════════════════════════ */
function Hero({ prices }: { prices: { monthlyAmount: number } }) {
  return (
    <section className="lp-hero">
      <div className="lp-hero-inner">
        <div className="lp-hero-text">
          <div className="lp-hero-pill">
            <span className="lp-dot lp-dot--pulse" style={{ width: 6, height: 6 }} />
            7-day free trial
          </div>
          <h1>
            Finally, a personal trainer you can afford.
          </h1>
          <p className="lp-hero-sub">
            Brandon builds personalized workout plans, texts them to you daily,
            and adapts when you text back. No app to download.
          </p>
          <div className="lp-hero-actions">
            <Link href="/login" className="lp-btn lp-btn--primary" onClick={() => trackEvent('cta_clicked', { location: 'hero' })}>
              Start your free trial <ArrowRight size={18} />
            </Link>
            <span className="lp-hero-fine">Cancel anytime · ${prices.monthlyAmount}/mo after trial</span>
          </div>
          <p className="lp-hero-trust">200+ users training with Brandon</p>
        </div>
        <div className="lp-hero-phone">
          <IPhoneFrame>
            <img src="/screenshot-sms.png" alt="Brandon SMS conversation" />
          </IPhoneFrame>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   IPHONE FRAME — reusable CSS phone bezel
   ═══════════════════════════════════════════ */
function IPhoneFrame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`iphone-frame ${className}`}>
      <div className="iphone-notch" />
      <div className="iphone-screen">{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   LOGO STRIP
   ═══════════════════════════════════════════ */
function LogoStrip() {
  return (
    <div className="lp-strip">
      <span>AI-powered</span>
      <span className="lp-strip-dot" />
      <span>SMS delivery</span>
      <span className="lp-strip-dot" />
      <span>No app required</span>
      <span className="lp-strip-dot" />
      <span>Cancel anytime</span>
    </div>
  );
}

/* ═══════════════════════════════════════════
   HOW IT WORKS — 4 steps with integrated visuals
   ═══════════════════════════════════════════ */
function HowItWorks() {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref);

  return (
    <section className="lp-how" id="how" ref={ref as any}>
      <div className="lp-container">
        <p className="lp-label lp-center">How it works</p>
        <h2 className="lp-h2 lp-center">
          From signup to first workout<br />in ~2 minutes
        </h2>
      </div>

      {/* Step 1: Tell us your goals → Plan Builder */}
      <StepPlanBuilder />

      {/* Step 2: Get texted your workout → SMS mockup */}
      <StepSMS />

      {/* Step 3: Track every rep → Tracker */}
      <StepTracker />

      {/* Step 4: Text to change anything → Conversation showcase */}
      <StepTextBrandon />
    </section>
  );
}

/* ─── Step 1: Tell us your goals ─── */
function StepPlanBuilder() {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  const [typedText, setTypedText] = useState("");
  const fullText = "Analyzing your profile and building a personalized 3-day push/pull program...";
  const [startTyping, setStartTyping] = useState(false);

  useEffect(() => {
    if (!startTyping) return;
    let i = 0;
    const interval = setInterval(() => {
      if (i < fullText.length) {
        setTypedText(fullText.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [startTyping]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStartTyping(true); },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="lp-step-row" ref={ref as any}>
      <div className="lp-step-row-inner">
        <div className="lp-step-text">
          <div className="lp-step-num">01</div>
          <h3 className="lp-step-title">Tell us your goals</h3>
          <p className="lp-step-desc">
            Quick onboarding — experience level, schedule, equipment, and what
            you're training for. Brandon uses it all to build a program that
            actually fits your life.
          </p>
        </div>
        <div className="lp-step-visual">
          <div className="lp-builder-screen">
            <div className="lp-builder-bar">
              <div className="lp-builder-dots"><span /><span /><span /></div>
              <div className="lp-builder-url">
                <div className="lp-builder-lock" />
                textbrandon.now
              </div>
              <div style={{ width: 56 }} />
            </div>
            <div className="lp-builder-body">
              <div className="lp-builder-header">
                <div className="lp-accent-bar" />
                <span>Building Your Plan</span>
              </div>
              <p className="lp-builder-typing">
                {typedText}
                <span className="lp-cursor" />
              </p>
              <div className="lp-builder-cards">
                {["Monday — Push", "Wednesday — Pull", "Friday — Legs"].map((day, i) => (
                  <div className="lp-builder-card" key={day} style={{ animationDelay: `${0.8 + i * 0.15}s` }}>
                    <div className="lp-builder-card-head">
                      <span className="lp-builder-day">{day}</span>
                      <div className="lp-builder-pulse" />
                    </div>
                    <div className="lp-builder-rows">
                      {[1, 2, 3].map((r) => (
                        <div className="lp-builder-row" key={r}>
                          <div className="lp-shimmer" style={{ width: `${50 + r * 15}%`, animationDelay: `${i * 0.1 + r * 0.05}s` }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="lp-builder-footer">
                <div className="lp-builder-status">
                  <div className="lp-builder-pulse" />
                  <span>Generating plan...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 2: Get texted your workout ─── */
function StepSMS() {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  return (
    <div className="lp-step-row lp-step-row--reverse" ref={ref as any}>
      <div className="lp-step-row-inner">
        <div className="lp-step-text">
          <div className="lp-step-num">02</div>
          <h3 className="lp-step-title">Get texted your workout</h3>
          <p className="lp-step-desc">
            Every morning, Brandon texts you the day's workout with a link to
            track it. No app to open, no notification to dismiss — it's just
            there in your messages.
          </p>
        </div>
        <div className="lp-step-visual">
          <IPhoneFrame>
            <img src="/screenshot-sms.png" alt="Brandon SMS conversation" />
          </IPhoneFrame>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 3: Track every rep ─── */
function StepTracker() {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  return (
    <div className="lp-step-row" ref={ref as any}>
      <div className="lp-step-row-inner">
        <div className="lp-step-text">
          <div className="lp-step-num">03</div>
          <h3 className="lp-step-title">Track every rep</h3>
          <p className="lp-step-desc">
            Tap the link in your text and you're in the tracker. Log weight and
            reps as you go — no login, no friction. Just open and start lifting.
          </p>
        </div>
        <div className="lp-step-visual">
          <IPhoneFrame>
            <img src="/screenshot-tracker.png" alt="Workout tracking interface" />
          </IPhoneFrame>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 4: Text to change anything ─── */
const conversations = [
  {
    user: "I hurt my shoulder, can we skip pressing this week?",
    brandon: "Done — I swapped out all pressing movements for the next 7 days. Your pull and leg work stays the same. Let me know when it feels better and I'll add them back in.",
  },
  {
    user: "Can you add a leg day? I want to train 4 days now",
    brandon: "Nice, let's do it. I added a dedicated leg day on Thursday. Your new split is Push / Pull / Legs / Legs. Updated plan starts tomorrow.",
  },
  {
    user: "I'm traveling next week, only have dumbbells",
    brandon: "No problem. I rebuilt next week's workouts using only dumbbells — no bench, no rack needed. Same muscle groups, just different exercises. You won't miss a beat.",
  },
  {
    user: "This feels too easy, can you make it harder?",
    brandon: "Say less. I bumped your working sets from 3 to 4 and added a drop set on your last exercise each day. Let me know how it feels after this week.",
  },
];

function StepTextBrandon() {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIdx((p) => (p + 1) % conversations.length);
        setFading(false);
      }, 300);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const convo = conversations[idx];

  return (
    <div className="lp-step-row lp-step-row--reverse" ref={ref as any}>
      <div className="lp-step-row-inner">
        <div className="lp-step-text">
          <div className="lp-step-num">04</div>
          <h3 className="lp-step-title">Text to change anything</h3>
          <p className="lp-step-desc">
            Switch goals, skip a muscle group, change your schedule — just text
            Brandon and your plan updates instantly. It's like having a personal
            trainer in your pocket.
          </p>
          <div className="lp-convo-dots">
            {conversations.map((_, i) => (
              <button
                key={i}
                className={`lp-convo-dot${i === idx ? " active" : ""}`}
                onClick={() => { setFading(true); setTimeout(() => { setIdx(i); setFading(false); }, 300); }}
              />
            ))}
          </div>
        </div>
        <div className="lp-step-visual">
          <div className={`lp-convo-demo${fading ? " fading" : ""}`}>
            <div className="lp-convo-bubble lp-convo-user">
              <p>{convo.user}</p>
            </div>
            <div className="lp-convo-bubble lp-convo-brandon">
              <div className="lp-convo-brandon-label">
                <span className="lp-convo-avatar">B</span>
                Brandon
              </div>
              <p>{convo.brandon}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   RESULTS — proof it works
   ═══════════════════════════════════════════ */
function Results() {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref);

  const heatmap = [1,1,1,0,1,1,0,1,1,1,1,0,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1];
  const prs = [
    { name: "Bench Press", from: 135, to: 185, gain: 50 },
    { name: "Squat", from: 185, to: 225, gain: 40 },
    { name: "Deadlift", from: 225, to: 275, gain: 50 },
  ];

  return (
    <section className="lp-results" ref={ref as any}>
      <div className="lp-container">
        <p className="lp-label lp-center">Real results</p>
        <h2 className="lp-h2 lp-center">
          This is what <span className="lp-em">consistency</span> looks like
        </h2>
        <div className="lp-results-grid">
          {/* Streak panel */}
          <div className="lp-consist-panel">
            <div className="lp-consist-label"><div className="lp-accent-bar" />Consistency</div>
            <div className="lp-consist-streak">
              <span className="lp-streak-num">47</span>
              <Flame size={24} className="lp-streak-fire" />
              <span className="lp-streak-label">day streak</span>
            </div>
            <div className="lp-heatmap-label">Last 4 weeks</div>
            <div className="lp-heatmap">
              {heatmap.map((v, i) => (
                <div key={i} className={`lp-heatmap-cell${v ? " active" : ""}`} />
              ))}
            </div>
            <div className="lp-consist-stats">
              <div><span className="lp-stat-num">52</span><span className="lp-stat-label">Longest Streak</span></div>
              <div><span className="lp-stat-num">156</span><span className="lp-stat-label">Total Workouts</span></div>
            </div>
          </div>

          {/* PR panel */}
          <div className="lp-consist-panel">
            <div className="lp-consist-label"><div className="lp-accent-bar" />Strength Gains</div>
            <div className="lp-pr-list">
              {prs.map((pr) => (
                <div className="lp-pr-card" key={pr.name}>
                  <div className="lp-pr-top">
                    <span className="lp-pr-name">{pr.name}</span>
                    <span className="lp-pr-badge">PR</span>
                  </div>
                  <div className="lp-pr-nums">
                    <span className="lp-pr-from">{pr.from}</span>
                    <span className="lp-pr-arrow">→</span>
                    <span className="lp-pr-to">{pr.to}</span>
                    <span className="lp-pr-gain">+{pr.gain} lbs</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="lp-pr-total">
              <span className="lp-pr-total-num">+140 lbs</span>
              <span className="lp-pr-total-label">Total added to Big 3</span>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   FAQ
   ═══════════════════════════════════════════ */
const faqData = [
  {
    q: "Is Brandon a real person?",
    a: "Brandon is an AI fitness coach trained on the same methods top personal trainers use. He's not a chatbot that gives generic answers. He builds real programs, tracks your progress, and adjusts your workouts based on what you tell him.",
  },
  {
    q: "What if I'm a complete beginner?",
    a: "Even better. Brandon meets you where you are. Tell him you've never lifted a weight, and he'll start you with the basics. No judgment. No ego. Just a plan that makes sense for your level right now.",
  },
  {
    q: "Do I need a gym?",
    a: "No. Brandon builds workouts around whatever you have. Dumbbells at home, a hotel room with nothing, a fully stocked gym — it doesn't matter. You tell him your setup and he makes it work.",
  },
  {
    q: "How do I track my workouts?",
    a: "Brandon sends you a one-tap tracking link after every workout. It opens in your browser — looks like Strong or Hevy, but you don't have to set anything up. Just tap, log your sets, done.",
  },
  {
    q: "Does Brandon text me or do I text him?",
    a: "Both. Brandon texts you every morning with today's workout. And you can text him anytime with questions, swaps, or updates. He's always available.",
  },
  {
    q: "Can Brandon help with nutrition?",
    a: "Yes. Ask him about meal ideas, calorie targets, or what to eat around your workouts. He gives straightforward advice based on your goals — not a 47-page meal plan you'll never follow.",
  },
  {
    q: "How is this different from a fitness app?",
    a: "Fitness apps give you a fixed program and hope it works. Brandon has a conversation with you. He asks questions. He adapts. He checks in. It's the difference between a vending machine and a personal trainer.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`lp-faq-item${open ? " open" : ""}`}>
      <button className="lp-faq-q" onClick={() => setOpen(!open)}>
        <span>{q}</span>
        <ChevronDown size={18} className="lp-faq-chevron" />
      </button>
      <div className="lp-faq-a-wrap">
        <p className="lp-faq-a">{a}</p>
      </div>
    </div>
  );
}

function FAQ({ prices }: { prices: { monthlyAmount: number; yearlyAmount: number; savingsPercent: number } }) {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref);

  const allFaq = [
    ...faqData,
    {
      q: "What does it cost?",
      a: `$${prices.monthlyAmount} a month or $${prices.yearlyAmount} a year (save ${prices.savingsPercent}%). That's less than a single session with a personal trainer. You get unlimited texts, personalized programming, and a coach who's available 24/7. Start with a free 7-day trial.`,
    },
  ];

  return (
    <section className="lp-faq" ref={ref as any}>
      <div className="lp-container">
        <p className="lp-label lp-center">FAQ</p>
        <h2 className="lp-h2 lp-center">Got questions? Good.</h2>
        <div className="lp-faq-list">
          {allFaq.map((item) => (
            <FAQItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   SOCIAL PROOF
   ═══════════════════════════════════════════ */
function SocialProof() {
  const ref = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);
  const touchX = useRef(0);
  useReveal(ref);

  useEffect(() => {
    const t = setInterval(() => setSlide((p) => (p + 1) % 2), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="lp-proof">
      <div className="lp-container" ref={ref as any}>
        <div className="lp-proof-carousel">
          <div
            className="lp-proof-track"
            style={{ transform: `translateX(-${slide * 100}%)` }}
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const d = touchX.current - e.changedTouches[0].clientX;
              if (Math.abs(d) > 50) {
                if (d > 0 && slide < 1) setSlide(1);
                else if (d < 0 && slide > 0) setSlide(0);
              }
            }}
          >
            <div className="lp-proof-card">
              <p className="lp-proof-quote">
                "I just texted what I wanted and had a full workout plan in literally a minute. This is how fitness apps should&nbsp;work."
              </p>
              <p className="lp-proof-attr"><span className="lp-dot" /> Early beta tester</p>
            </div>
            <div className="lp-proof-card">
              <p className="lp-proof-quote">
                "Getting texted every morning just <em>felt</em> different. I'm finally going to the gym consistently for the first time in&nbsp;years."
              </p>
              <p className="lp-proof-attr"><span className="lp-dot" /> Early beta tester</p>
            </div>
          </div>
          <div className="lp-proof-dots">
            {[0, 1].map((i) => (
              <button key={i} className={`lp-proof-dot${i === slide ? " active" : ""}`} onClick={() => setSlide(i)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   PRICING
   ═══════════════════════════════════════════ */
function Pricing({ prices }: { prices: { monthlyAmount: number; yearlyAmount: number; yearlyMonthly: string; savingsPercent: number } }) {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref);

  return (
    <section className="lp-pricing" id="pricing" ref={ref as any}>
      <div className="lp-container">
        <p className="lp-label lp-center">Simple pricing</p>
        <h2 className="lp-h2 lp-center">A personal trainer for the price of a&nbsp;coffee</h2>
        <div className="lp-pricing-cards">
          <div className="lp-price-card">
            <div className="lp-price-tier">Monthly</div>
            <div className="lp-price-amount">${prices.monthlyAmount}<span className="lp-price-per">/mo</span></div>
            <div className="lp-price-detail">Billed monthly</div>
            <Link href="/login" className="lp-btn lp-btn--secondary" onClick={() => trackEvent('cta_clicked', { location: 'pricing_monthly' })}>Start free trial</Link>
          </div>
          <div className="lp-price-card best">
            <div className="lp-price-badge">Save {prices.savingsPercent}%</div>
            <div className="lp-price-tier">Yearly</div>
            <div className="lp-price-amount">${prices.yearlyMonthly}<span className="lp-price-per">/mo</span></div>
            <div className="lp-price-detail">${prices.yearlyAmount} billed annually</div>
            <Link href="/login" className="lp-btn lp-btn--primary" onClick={() => trackEvent('cta_clicked', { location: 'pricing_yearly' })}>Start free trial</Link>
          </div>
        </div>
        <p className="lp-pricing-fine">7-day free trial on both plans. Cancel anytime.</p>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   FINAL CTA
   ═══════════════════════════════════════════ */
function FinalCTA() {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref);

  return (
    <section className="lp-final" ref={ref as any}>
      <div className="lp-container lp-center">
        <h2 className="lp-h2">
          Your <span className="lp-em">AI</span> coach is&nbsp;ready
          <span className="lp-dot lp-dot--pulse" style={{ width: 10, height: 10, marginLeft: 6 }} />
        </h2>
        <p className="lp-final-sub">Try it free for 7 days.</p>
        <Link href="/login" className="lp-btn lp-btn--primary lp-btn--lg" onClick={() => trackEvent('cta_clicked', { location: 'final_cta' })}>
          Start your free trial <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════ */
function Footer() {
  return (
    <footer className="lp-footer">
      <span className="lp-footer-brand">Brandon<span className="lp-dot" /></span>
      <span>© 2026 Brandon AI</span>
      <span className="lp-footer-links">
        <a href="/legal">Legal</a>
        <span className="lp-footer-sep">·</span>
        <a href="mailto:support@textbrandon.now">Contact</a>
      </span>
    </footer>
  );
}

/* ═══════════════════════════════════════════
   FLOATING MOBILE CTA
   ═══════════════════════════════════════════ */
function FloatingMobileCTA() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(".lp-hero");
    if (!hero) return;
    const obs = new IntersectionObserver(([e]) => setVisible(!e.isIntersecting));
    obs.observe(hero);
    return () => obs.disconnect();
  }, []);

  return (
    <div className={`lp-float-bar${visible ? " visible" : ""}`}>
      <Link href="/login" onClick={() => trackEvent('cta_clicked', { location: 'floating_mobile' })}>Start free trial <ArrowRight size={16} /></Link>
      <div className="lp-float-fine">7-day free trial · Cancel anytime</div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════ */
function useReveal(ref: React.RefObject<Element | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) el.classList.add("vis"); },
      { threshold: 0.06, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
}

/* ═══════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════ */
function LandingStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&display=swap');

      /* ════════ RESET ════════ */
      .lp {
        font-family: 'DM Sans', sans-serif;
        color: #fafafa;
        background: #060606;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        overflow-x: hidden;
      }
      body { margin: 0; background: #060606; }
      .lp *, .lp *::before, .lp *::after { box-sizing: border-box; margin: 0; padding: 0; }

      /* ════════ VARIABLES ════════ */
      .lp {
        --c-bg: #060606;
        --c-surface: #0f0f0f;
        --c-surface-2: #161616;
        --c-border: rgba(255,255,255,0.06);
        --c-border-2: rgba(255,255,255,0.1);
        --c-text: #fafafa;
        --c-text-2: #a1a1a1;
        --c-text-3: #666;
        --c-green: #34d399;
        --c-green-deep: #10b981;
        --c-green-glow: rgba(52,211,153,0.12);
        --c-green-glow-2: rgba(52,211,153,0.06);
        --radius: 16px;
      }

      /* ════════ COMMON ════════ */
      .lp-container { max-width: 1100px; margin: 0 auto; padding: 0 32px; }
      .lp-center { text-align: center; }
      .lp-label {
        font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 4px; color: var(--c-green); margin-bottom: 16px;
      }
      .lp-h2 {
        font-size: clamp(30px, 5vw, 50px); font-weight: 800;
        letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 56px;
      }
      .lp-em {
        color: var(--c-green);
        font-style: italic;
        text-shadow: 0 0 40px rgba(52,211,153,0.3);
      }

      /* ════════ DOT ════════ */
      .lp-dot {
        display: inline-block; width: 7px; height: 7px;
        background: var(--c-green); border-radius: 50%;
        vertical-align: middle; position: relative; margin-left: 2px;
      }
      .lp-dot--pulse::after {
        content: ''; position: absolute; inset: -4px; border-radius: 50%;
        background: var(--c-green); opacity: 0; z-index: -1;
        animation: lp-ping 2.5s cubic-bezier(0,0,0.2,1) infinite;
      }
      @keyframes lp-ping {
        0% { transform: scale(1); opacity: 0.4; }
        75%, 100% { transform: scale(4); opacity: 0; }
      }

      /* ════════ BUTTONS ════════ */
      .lp-btn {
        font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 15px;
        border: none; cursor: pointer; text-decoration: none;
        display: inline-flex; align-items: center; justify-content: center;
        gap: 8px; border-radius: 100px; transition: all 0.25s ease;
        padding: 14px 36px;
      }
      .lp-btn--primary {
        background: var(--c-green); color: #000;
      }
      .lp-btn--primary:hover {
        background: var(--c-green-deep);
        box-shadow: 0 8px 32px rgba(52,211,153,0.25);
        transform: translateY(-2px);
      }
      .lp-btn--secondary {
        background: var(--c-surface-2); color: var(--c-text); border: 1px solid var(--c-border-2);
      }
      .lp-btn--secondary:hover { background: #1f1f1f; }
      .lp-btn--lg { font-size: 17px; padding: 18px 48px; }

      /* ════════ NAV ════════ */
      .lp-nav {
        position: fixed; top: 0; left: 0; right: 0; z-index: 100;
        padding: 20px 40px; display: flex; align-items: center;
        justify-content: space-between; transition: all 0.3s ease;
      }
      .lp-nav.scrolled {
        background: rgba(6,6,6,0.85); backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        padding: 14px 40px; border-bottom: 1px solid var(--c-border);
      }
      .lp-logo {
        font-weight: 800; font-size: 22px; letter-spacing: -0.5px;
        text-decoration: none; color: var(--c-text); display: flex; align-items: center;
      }
      .lp-nav-links { display: flex; align-items: center; gap: 28px; }
      .lp-nav-link {
        font-size: 13px; font-weight: 500; color: var(--c-text-2);
        text-decoration: none; transition: color 0.2s;
      }
      .lp-nav-link:hover { color: var(--c-text); }
      .lp-nav-cta {
        background: var(--c-green); color: #000; font-weight: 700;
        font-size: 13px; padding: 10px 24px; border-radius: 100px;
        text-decoration: none; display: inline-flex; align-items: center;
        gap: 6px; transition: all 0.2s ease;
      }
      .lp-nav-cta:hover { background: var(--c-green-deep); transform: scale(1.03); }

      /* ════════ HERO ════════ */
      .lp-hero {
        min-height: 100vh; min-height: 100svh;
        display: flex; align-items: center; justify-content: center;
        padding: 120px 32px 80px; position: relative; overflow: hidden;
      }
      .lp-hero::before {
        content: ''; position: absolute; top: 0; left: 30%; width: 600px; height: 600px;
        background: radial-gradient(circle, rgba(52,211,153,0.08) 0%, transparent 60%);
        pointer-events: none;
      }
      .lp-hero-inner {
        max-width: 1100px; width: 100%; margin: 0 auto;
        display: grid; grid-template-columns: 1fr 1fr; gap: 64px;
        align-items: center; position: relative; z-index: 1;
      }
      .lp-hero-text { max-width: 520px; }
      .lp-hero-pill {
        display: inline-flex; align-items: center; gap: 10px;
        background: var(--c-green-glow); border: 1px solid rgba(52,211,153,0.15);
        color: var(--c-green); font-size: 12px; font-weight: 700;
        padding: 8px 20px; border-radius: 100px; margin-bottom: 28px;
        opacity: 0; animation: lp-fadeUp 0.6s ease forwards 0.1s;
      }
      .lp-hero h1 {
        font-size: clamp(38px, 5.5vw, 58px); font-weight: 800;
        line-height: 1.08; letter-spacing: -2px; margin-bottom: 20px;
        opacity: 0; animation: lp-fadeUp 0.8s ease forwards 0.2s;
      }
      .lp-hero-sub {
        font-size: 17px; line-height: 1.6; color: var(--c-text-2);
        margin-bottom: 36px; max-width: 420px;
        opacity: 0; animation: lp-fadeUp 0.8s ease forwards 0.35s;
      }
      .lp-hero-actions {
        display: flex; flex-direction: column; gap: 12px; align-items: flex-start;
        opacity: 0; animation: lp-fadeUp 0.8s ease forwards 0.5s;
      }
      .lp-hero-fine { font-size: 13px; color: var(--c-text-3); }
      .lp-hero-trust {
        font-size: 12px; color: var(--c-text-3); margin-top: 16px;
        letter-spacing: 0.5px; opacity: 0;
        animation: lp-fadeUp 0.8s ease forwards 0.65s;
      }
      .lp-hero-phone {
        display: flex; justify-content: center;
        opacity: 0; animation: lp-fadeUp 1s ease forwards 0.4s;
      }

      /* ════════ IPHONE FRAME ════════ */
      .iphone-frame {
        width: 300px; border-radius: 40px; padding: 12px;
        background: #1a1a1a; position: relative;
        box-shadow:
          0 40px 100px -20px rgba(0,0,0,0.8),
          0 0 0 1px rgba(255,255,255,0.08),
          inset 0 0 0 1px rgba(255,255,255,0.04),
          0 0 80px -20px rgba(52,211,153,0.1);
      }
      .iphone-notch {
        position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
        width: 100px; height: 28px; background: #1a1a1a; border-radius: 0 0 18px 18px;
        z-index: 10;
      }
      .iphone-screen {
        border-radius: 30px; overflow: hidden; background: #000;
        aspect-ratio: 9 / 19.5;
      }
      .iphone-screen img { width: 100%; height: 100%; object-fit: cover; display: block; }

      /* ════════ STRIP ════════ */
      .lp-strip {
        padding: 18px 32px; display: flex; align-items: center;
        justify-content: center; gap: 20px; flex-wrap: wrap;
        font-size: 12px; font-weight: 600; color: var(--c-text-3);
        text-transform: uppercase; letter-spacing: 2px;
        border-top: 1px solid var(--c-border); border-bottom: 1px solid var(--c-border);
      }
      .lp-strip-dot {
        width: 4px; height: 4px; border-radius: 50%; background: var(--c-green); opacity: 0.5;
      }

      /* ════════ HOW IT WORKS — SECTION HEADER ════════ */
      .lp-how { padding: 120px 0 0; }

      /* ════════ STEP ROWS — alternating text + visual ════════ */
      .lp-step-row {
        padding: 80px 0;
        position: relative;
        opacity: 0; transform: translateY(32px);
        transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1);
      }
      .lp-step-row.vis { opacity: 1; transform: translateY(0); }
      .lp-step-row + .lp-step-row {
        border-top: 1px solid var(--c-border);
      }
      .lp-step-row-inner {
        max-width: 1100px; margin: 0 auto; padding: 0 32px;
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 64px; align-items: center;
      }
      .lp-step-row--reverse .lp-step-row-inner {
        direction: rtl;
      }
      .lp-step-row--reverse .lp-step-row-inner > * {
        direction: ltr;
      }

      /* Step text side */
      .lp-step-num {
        font-size: 64px; font-weight: 900; line-height: 1;
        background: linear-gradient(135deg, var(--c-green), var(--c-green-deep));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        margin-bottom: 20px; letter-spacing: -3px;
        filter: drop-shadow(0 0 20px rgba(52,211,153,0.2));
      }
      .lp-step-title {
        font-size: clamp(24px, 3.5vw, 36px); font-weight: 800;
        letter-spacing: -1px; line-height: 1.15; margin-bottom: 16px;
      }
      .lp-step-desc {
        font-size: 16px; line-height: 1.7; color: var(--c-text-2);
        max-width: 400px;
      }

      /* ════════ PLAN BUILDER (visual for step 1) ════════ */
      .lp-builder-screen {
        width: 100%; border-radius: 16px;
        border: 1px solid var(--c-border-2); overflow: hidden;
        background: var(--c-surface);
        box-shadow: 0 40px 80px -20px rgba(0,0,0,0.5), 0 0 80px -30px rgba(52,211,153,0.08);
      }
      .lp-builder-bar {
        display: flex; align-items: center; padding: 10px 16px;
        border-bottom: 1px solid var(--c-border); background: rgba(15,15,15,0.8);
      }
      .lp-builder-dots { display: flex; gap: 6px; }
      .lp-builder-dots span { width: 10px; height: 10px; border-radius: 50%; background: #2a2a2a; }
      .lp-builder-url {
        flex: 1; display: flex; align-items: center; justify-content: center;
        gap: 6px; font-size: 11px; color: var(--c-text-3);
      }
      .lp-builder-lock {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--c-green); opacity: 0.5;
      }
      .lp-builder-body { padding: 24px; }
      .lp-builder-header {
        display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
      }
      .lp-builder-header span { font-size: 18px; font-weight: 700; }
      .lp-accent-bar { width: 3px; height: 20px; background: var(--c-green); border-radius: 2px; }
      .lp-builder-typing {
        font-size: 13px; color: var(--c-text-2); margin-bottom: 20px; min-height: 20px;
      }
      .lp-cursor {
        display: inline-block; width: 2px; height: 14px;
        background: var(--c-green); margin-left: 2px;
        animation: lp-blink 0.8s step-end infinite; vertical-align: text-bottom;
      }
      @keyframes lp-blink { 50% { opacity: 0; } }
      .lp-builder-cards { display: flex; flex-direction: column; gap: 12px; }
      .lp-builder-card {
        border: 1px solid var(--c-border); border-radius: 12px;
        overflow: hidden; background: rgba(255,255,255,0.01);
        opacity: 0; animation: lp-fadeUp 0.5s ease forwards;
      }
      .lp-builder-card-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; border-bottom: 1px solid var(--c-border);
      }
      .lp-builder-day { font-size: 12px; font-weight: 700; color: var(--c-text-2); text-transform: uppercase; letter-spacing: 1px; }
      .lp-builder-pulse {
        width: 6px; height: 6px; border-radius: 50%; background: var(--c-green);
        animation: lp-pulse-glow 1.5s ease infinite;
      }
      @keyframes lp-pulse-glow {
        0%, 100% { opacity: 0.4; box-shadow: none; }
        50% { opacity: 1; box-shadow: 0 0 8px var(--c-green); }
      }
      .lp-builder-rows { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
      .lp-builder-row { height: 12px; border-radius: 6px; overflow: hidden; background: var(--c-surface-2); }
      .lp-shimmer {
        height: 100%; border-radius: 6px;
        background: linear-gradient(90deg, var(--c-surface-2) 0%, #1f1f1f 50%, var(--c-surface-2) 100%);
        background-size: 200% 100%;
        animation: lp-shimmer 1.5s ease infinite;
      }
      @keyframes lp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      .lp-builder-footer {
        margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--c-border);
      }
      .lp-builder-status {
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; color: var(--c-text-3);
      }

      /* ════════ TRACKER (visual for step 3) ════════ */
      .lp-tracker-demo {
        padding: 28px; border-radius: var(--radius);
        border: 1px solid var(--c-border); background: var(--c-surface);
        box-shadow: 0 40px 80px -20px rgba(0,0,0,0.5);
      }
      .lp-tracker-head {
        display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;
      }
      .lp-tracker-exercise { display: flex; align-items: center; gap: 8px; font-weight: 600; }
      .lp-tracker-icon {
        width: 32px; height: 32px; border-radius: 8px;
        background: var(--c-green-glow); display: flex; align-items: center;
        justify-content: center; font-size: 14px;
      }
      .lp-tracker-scheme {
        font-size: 12px; color: var(--c-text-3); background: var(--c-surface-2);
        padding: 4px 10px; border-radius: 6px;
      }
      .lp-tracker-progress { margin-bottom: 14px; }
      .lp-tracker-bar {
        height: 4px; background: var(--c-surface-2); border-radius: 2px;
        overflow: hidden; margin-bottom: 4px;
      }
      .lp-tracker-bar-fill {
        height: 100%; background: linear-gradient(90deg, var(--c-green), var(--c-green-deep));
        border-radius: 2px;
      }
      .lp-tracker-progress span { font-size: 10px; color: var(--c-text-3); }
      .lp-tracker-sets { display: flex; flex-direction: column; gap: 6px; }
      .lp-tracker-set {
        display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        border-radius: 8px; background: var(--c-surface-2); border: 1px solid var(--c-border);
      }
      .lp-tracker-set.done {
        background: rgba(52,211,153,0.06); border-color: rgba(52,211,153,0.15);
      }
      .lp-set-num { font-size: 11px; font-weight: 600; width: 40px; color: var(--c-text-3); }
      .lp-tracker-set.done .lp-set-num { color: var(--c-green); }
      .lp-set-val {
        flex: 1; text-align: center; font-size: 12px; color: var(--c-text-2);
        background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px;
      }
      .lp-set-check {
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--c-surface-2); border: 1px solid var(--c-border-2);
        display: flex; align-items: center; justify-content: center;
      }
      .lp-set-check.checked { background: var(--c-green); border-color: var(--c-green); color: #000; }

      /* ════════ CONVERSATION SHOWCASE (visual for step 4) ════════ */
      .lp-convo-demo {
        display: flex; flex-direction: column; gap: 16px;
        transition: opacity 0.3s ease;
        min-height: 280px;
      }
      .lp-convo-demo.fading { opacity: 0; }
      .lp-convo-bubble {
        padding: 18px 20px; border-radius: 16px; font-size: 15px; line-height: 1.6;
      }
      .lp-convo-user {
        background: #2563eb; color: #fff; border-radius: 16px 16px 4px 16px;
        align-self: flex-end; max-width: 85%;
      }
      .lp-convo-brandon {
        background: var(--c-surface); border: 1px solid var(--c-border);
        border-radius: 16px 16px 16px 4px; max-width: 90%;
      }
      .lp-convo-brandon-label {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; font-weight: 700; color: var(--c-green);
        margin-bottom: 8px;
      }
      .lp-convo-avatar {
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--c-green); color: #000; font-size: 11px; font-weight: 800;
        display: flex; align-items: center; justify-content: center;
      }
      .lp-convo-brandon p { color: var(--c-text-2); }
      .lp-convo-dots {
        display: flex; gap: 6px; margin-top: 24px;
      }
      .lp-convo-dot {
        width: 8px; height: 8px; border-radius: 50%; border: none;
        background: #2a2a2a; cursor: pointer; padding: 0; transition: all 0.25s ease;
      }
      .lp-convo-dot.active { background: var(--c-green); width: 24px; border-radius: 4px; }

      /* ════════ RESULTS SECTION ════════ */
      .lp-results { padding: 100px 0; }
      .lp-results-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
      }
      .lp-results-tracker {
        display: flex; flex-direction: column; align-items: center;
      }
      .lp-results-tracker .iphone-frame { margin-top: 8px; }
      .iphone--results { width: 200px; }
      .lp-consist-panel {
        padding: 24px; border-radius: var(--radius); border: 1px solid var(--c-border);
        background: var(--c-surface);
      }
      .lp-consist-label {
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 2px; color: var(--c-text-3); margin-bottom: 20px;
      }
      .lp-consist-streak { text-align: center; margin-bottom: 20px; }
      .lp-streak-num {
        font-size: 56px; font-weight: 800; letter-spacing: -3px;
        background: linear-gradient(135deg, var(--c-green), var(--c-green-deep));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        display: block; line-height: 1;
        filter: drop-shadow(0 0 20px rgba(52,211,153,0.3));
      }
      .lp-streak-fire { color: #f97316; margin: 4px auto; display: block; }
      .lp-streak-label { font-size: 13px; color: var(--c-text-2); display: block; }
      .lp-heatmap-label { font-size: 10px; color: var(--c-text-3); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
      .lp-heatmap { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
      .lp-heatmap-cell {
        aspect-ratio: 1; border-radius: 3px; background: var(--c-surface-2);
      }
      .lp-heatmap-cell.active {
        background: var(--c-green); box-shadow: 0 0 6px rgba(52,211,153,0.4);
      }

      /* PR panel */
      .lp-pr-list { display: flex; flex-direction: column; gap: 8px; }
      .lp-pr-card {
        padding: 12px; border-radius: 10px;
        background: var(--c-green-glow); border: 1px solid rgba(52,211,153,0.12);
      }
      .lp-pr-top {
        display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;
      }
      .lp-pr-name { font-size: 12px; font-weight: 600; }
      .lp-pr-badge {
        font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;
        padding: 2px 8px; border-radius: 100px; background: var(--c-green); color: #000;
      }
      .lp-pr-nums { display: flex; align-items: center; gap: 6px; }
      .lp-pr-from { font-size: 16px; font-weight: 700; color: var(--c-text-3); }
      .lp-pr-arrow { color: var(--c-green); font-size: 14px; }
      .lp-pr-to { font-size: 16px; font-weight: 700; }
      .lp-pr-gain { font-size: 12px; font-weight: 700; color: var(--c-green); margin-left: auto; }
      .lp-pr-total {
        margin-top: 14px; padding: 16px; border-radius: 10px; text-align: center;
        background: linear-gradient(135deg, rgba(52,211,153,0.12) 0%, rgba(52,211,153,0.04) 100%);
      }
      .lp-pr-total-num {
        font-size: 28px; font-weight: 800; color: var(--c-green); display: block;
        text-shadow: 0 0 20px rgba(52,211,153,0.3);
      }
      .lp-pr-total-label {
        font-size: 10px; color: var(--c-text-3); text-transform: uppercase;
        letter-spacing: 1px; margin-top: 2px; display: block;
      }
      .lp-consist-stats {
        display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
        margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--c-border); text-align: center;
      }
      .lp-stat-num { font-size: 22px; font-weight: 800; display: block; }
      .lp-stat-label { font-size: 10px; color: var(--c-text-3); text-transform: uppercase; letter-spacing: 1px; display: block; }

      /* ════════ FAQ ════════ */
      .lp-faq { padding: 100px 0; }
      .lp-faq-list {
        max-width: 700px; margin: 0 auto;
        display: flex; flex-direction: column;
      }
      .lp-faq-item {
        border-bottom: 1px solid var(--c-border);
      }
      .lp-faq-item:first-child { border-top: 1px solid var(--c-border); }
      .lp-faq-q {
        width: 100%; display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer;
        font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 600;
        color: var(--c-text); text-align: left; transition: color 0.2s;
      }
      .lp-faq-q:hover { color: var(--c-green); }
      .lp-faq-chevron {
        color: var(--c-text-3); flex-shrink: 0;
        transition: transform 0.3s cubic-bezier(0.16,1,0.3,1), color 0.2s;
      }
      .lp-faq-item.open .lp-faq-chevron {
        transform: rotate(180deg); color: var(--c-green);
      }
      .lp-faq-a-wrap {
        max-height: 0; overflow: hidden;
        transition: max-height 0.4s cubic-bezier(0.16,1,0.3,1);
      }
      .lp-faq-item.open .lp-faq-a-wrap {
        max-height: 300px;
      }
      .lp-faq-a {
        font-size: 15px; line-height: 1.7; color: var(--c-text-2);
        padding-bottom: 22px; max-width: 600px;
      }

      /* ════════ SOCIAL PROOF ════════ */
      .lp-proof { padding: 80px 0 100px; }
      .lp-proof-carousel { overflow: hidden; position: relative; }
      .lp-proof-track { display: flex; transition: transform 0.5s cubic-bezier(0.16,1,0.3,1); width: 100%; }
      .lp-proof-card {
        width: 100%; min-width: 100%; flex-shrink: 0; padding: 60px 48px; box-sizing: border-box;
        background: var(--c-surface); border: 1px solid var(--c-border);
        border-radius: var(--radius); text-align: center; position: relative;
      }
      .lp-proof-card::before {
        content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
        width: 48px; height: 3px; background: var(--c-green); border-radius: 0 0 2px 2px;
      }
      .lp-proof-quote {
        font-size: clamp(18px, 3vw, 24px); font-weight: 500;
        line-height: 1.5; letter-spacing: -0.3px;
        max-width: 540px; margin: 0 auto 20px;
      }
      .lp-proof-attr {
        font-size: 13px; color: var(--c-text-3); font-weight: 600;
        display: flex; align-items: center; justify-content: center; gap: 8px;
      }
      .lp-proof-attr .lp-dot { width: 4px; height: 4px; }
      .lp-proof-dots { display: flex; justify-content: center; gap: 8px; margin-top: 20px; }
      .lp-proof-dot {
        width: 8px; height: 8px; border-radius: 50%; border: none;
        background: #2a2a2a; cursor: pointer; padding: 0; transition: all 0.25s ease;
      }
      .lp-proof-dot.active { background: var(--c-green); width: 24px; border-radius: 4px; }

      /* ════════ PRICING ════════ */
      .lp-pricing { padding: 0 0 100px; }
      .lp-pricing-cards {
        display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        max-width: 580px; margin: 0 auto;
      }
      .lp-price-card {
        border-radius: var(--radius); padding: 36px 28px; text-align: center;
        border: 1px solid var(--c-border); background: var(--c-surface);
        position: relative; transition: all 0.25s ease;
      }
      .lp-price-card:hover { border-color: var(--c-border-2); }
      .lp-price-card.best { border-color: var(--c-green); }
      .lp-price-card.best:hover { box-shadow: 0 8px 32px rgba(52,211,153,0.1); }
      .lp-price-badge {
        position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
        background: var(--c-green); color: #000; font-size: 11px; font-weight: 800;
        padding: 5px 16px; border-radius: 100px; letter-spacing: 0.5px;
      }
      .lp-price-tier {
        font-size: 12px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 2px; color: var(--c-text-3); margin-bottom: 16px;
      }
      .lp-price-amount {
        font-size: 48px; font-weight: 800; letter-spacing: -2px; line-height: 1; margin-bottom: 4px;
      }
      .lp-price-per { font-size: 16px; font-weight: 500; color: var(--c-text-3); }
      .lp-price-detail { font-size: 13px; color: var(--c-text-3); margin-bottom: 24px; }
      .lp-pricing-fine { text-align: center; font-size: 13px; color: var(--c-text-3); margin-top: 20px; }

      /* ════════ FINAL CTA ════════ */
      .lp-final { padding: 80px 0 140px; position: relative; }
      .lp-final::before {
        content: ''; position: absolute; bottom: 20%; left: 50%; transform: translateX(-50%);
        width: 500px; height: 400px;
        background: radial-gradient(ellipse, var(--c-green-glow-2) 0%, transparent 60%);
        pointer-events: none;
      }
      .lp-final > * { position: relative; }
      .lp-final .lp-h2 { margin-bottom: 16px; }
      .lp-final-sub { font-size: 18px; color: var(--c-text-2); margin-bottom: 36px; }

      /* ════════ FOOTER ════════ */
      .lp-footer {
        border-top: 1px solid var(--c-border); padding: 32px; display: flex;
        align-items: center; justify-content: space-between;
        font-size: 13px; color: var(--c-text-3); max-width: 1100px; margin: 0 auto;
      }
      .lp-footer-brand {
        font-weight: 800; font-size: 16px; color: var(--c-text);
        display: flex; align-items: center;
      }
      .lp-footer-links {
        display: flex; align-items: center; gap: 6px;
        font-size: 13px;
      }
      .lp-footer-links a {
        color: var(--c-text-2); text-decoration: none;
        transition: color 0.15s;
      }
      .lp-footer-links a:hover { color: var(--c-text); }
      .lp-footer-sep { color: var(--c-text-3); }

      /* ════════ FLOATING MOBILE CTA ════════ */
      .lp-float-bar {
        display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 99;
        padding: 12px 16px; padding-bottom: calc(12px + env(safe-area-inset-bottom));
        background: rgba(6,6,6,0.92); backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-top: 1px solid var(--c-border); transform: translateY(100%);
        transition: transform 0.3s ease;
      }
      .lp-float-bar.visible { transform: translateY(0); }
      .lp-float-bar a {
        display: flex; align-items: center; justify-content: center; width: 100%;
        background: var(--c-green); color: #000; font-family: 'DM Sans', sans-serif;
        font-weight: 700; font-size: 15px; padding: 14px; border-radius: 12px;
        text-decoration: none; gap: 8px;
      }
      .lp-float-fine { font-size: 11px; color: var(--c-text-3); text-align: center; margin-top: 6px; }

      /* ════════ ANIMATIONS ════════ */
      @keyframes lp-fadeUp {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .lp-how, .lp-results, .lp-faq, .lp-proof > .lp-container,
      .lp-pricing, .lp-final {
        opacity: 0; transform: translateY(32px);
        transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1);
      }
      .vis {
        opacity: 1 !important; transform: translateY(0) !important;
      }

      /* ════════ RESPONSIVE — TABLET ════════ */
      @media (max-width: 768px) {
        .lp-nav { padding: 16px 24px; }
        .lp-nav.scrolled { padding: 12px 24px; }
        .lp-nav-link { display: none; }
        .lp-container { padding: 0 24px; }

        .lp-hero-inner {
          grid-template-columns: 1fr; gap: 24px; text-align: center;
        }
        .lp-hero-phone { order: -1; }
        .lp-hero-text { max-width: 100%; }
        .lp-hero-actions { align-items: center; }
        .lp-hero-sub { max-width: 100%; margin-bottom: 24px; }
        .lp-hero-pill { margin-bottom: 16px; }
        .lp-hero h1 { margin-bottom: 12px; }
        .iphone-frame { width: 260px; }

        .lp-step-row-inner {
          grid-template-columns: 1fr; gap: 40px; padding: 0 24px;
        }
        .lp-step-row--reverse .lp-step-row-inner { direction: ltr; }
        .lp-step-text { text-align: center; }
        .lp-step-desc { max-width: 100%; margin: 0 auto; }
        .lp-step-visual { display: flex; justify-content: center; }
        .lp-convo-dots { justify-content: center; }
        .lp-step-num { font-size: 48px; }

        .lp-results-grid { grid-template-columns: 1fr 1fr; }
        .lp-pricing-cards { grid-template-columns: 1fr; max-width: 340px; }
        .lp-price-card.best { order: -1; }
      }

      /* ════════ RESPONSIVE — MOBILE ════════ */
      @media (max-width: 480px) {
        .lp-container { padding: 0 16px; }
        .lp-nav { padding: 12px 16px; }
        .lp-nav.scrolled { padding: 10px 16px; }
        .lp-logo { font-size: 18px; }
        .lp-nav-cta { padding: 8px 18px; font-size: 12px; }

        .lp-hero { min-height: auto; padding: 80px 16px 40px; }
        .lp-hero-inner { gap: 20px; }
        .lp-hero h1 { font-size: 32px; letter-spacing: -1.5px; margin-bottom: 8px; }
        .lp-hero-sub { font-size: 15px; margin-bottom: 20px; }
        .lp-btn--primary { width: 100%; }
        .iphone-frame { width: 250px; padding: 8px; border-radius: 32px; }
        .iphone-notch { width: 80px; height: 22px; top: 8px; border-radius: 0 0 14px 14px; }
        .iphone-screen { border-radius: 24px; }

        .lp-strip { font-size: 10px; gap: 12px; padding: 14px 16px; }
        .lp-how { padding: 80px 0 0; }
        .lp-step-row { padding: 56px 0; }
        .lp-step-row-inner { padding: 0 16px; gap: 32px; }
        .lp-h2 { margin-bottom: 36px; }
        .lp-step-num { font-size: 40px; }
        .lp-step-title { font-size: 24px; }
        .lp-convo-demo { min-height: 340px; }

        .lp-results { padding: 56px 0; }
        .lp-results-grid { grid-template-columns: 1fr; }
        .lp-faq { padding: 56px 0; }
        .lp-faq-list { max-width: 100%; }
        .lp-faq-q { font-size: 15px; padding: 18px 8px; }
        .lp-faq-a { font-size: 14px; padding-left: 8px; padding-right: 8px; }
        .lp-proof { padding: 56px 0 80px; }
        .lp-proof-carousel { overflow: hidden; position: relative; }
        .lp-proof-track { display: flex; width: 100%; }
        .lp-proof-card { min-width: 100%; padding: 32px 20px; box-sizing: border-box; }
        .lp-proof-quote { font-size: 16px !important; line-height: 1.6; max-width: 100%; }
        .lp-price-card { padding: 28px 20px; }
        .lp-price-amount { font-size: 40px; }

        .lp-final { padding-bottom: 64px; }
        .lp-footer { flex-direction: column; gap: 8px; padding: 28px 16px; align-items: center; text-align: center; }
      }

      @media (max-width: 360px) {
        .lp-hero { padding-top: 80px; }
        .lp-hero h1 { font-size: 28px; }
        .iphone-frame { width: 220px; }
      }
    `}</style>
  );
}
