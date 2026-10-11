import { useEffect, useRef } from 'react';
import type { Tab } from '../nav';
import { leaveDemo } from '../demo';

interface Step {
  tab: Tab;
  title: string;
  text: string;
}

export const TOUR: Step[] = [
  { tab: 'today', title: 'Today', text: 'One screen that answers “did I do my thing today?” Habits, today’s workout, streaks and the next reward, at a glance.' },
  { tab: 'month', title: 'Month', text: 'Training days and money dates on one calendar: bills, planned sessions and what’s done.' },
  { tab: 'train', title: 'Train', text: 'Push, pull and legs logged rep by rep, with a flag when it’s time to add weight.' },
  { tab: 'money', title: 'Money', text: 'Spending by category and a survival fund building towards six months of expenses, then an investment fund.' },
  { tab: 'career', title: 'Career', text: 'Portfolio projects and daily GitHub commits tracked against a one-year goal.' },
  { tab: 'rewards', title: 'Rewards', text: 'Badges for consistency, and real-world treats you set up yourself and earn.' },
  { tab: 'advisor', title: 'Advisor', text: 'A weekly review and answers about your own numbers. The coach works offline; Claude can be added with your own key.' },
  { tab: 'today', title: 'Yours, and private', text: 'Real data stays on your device. Sign in to sync across devices, encrypted so even the server can’t read it. This demo uses made-up data and saves nothing.' },
];

export function DemoTour({ step, setStep, go, onClose }: { step: number; setStep: (n: number) => void; go: (t: Tab) => void; onClose: () => void }) {
  const s = TOUR[step];
  const last = step === TOUR.length - 1;
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    go(s.tab);
    nextRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className="tour" role="region" aria-label="Demo tour">
      <p className="tour-count">
        {step + 1} of {TOUR.length}
      </p>
      <h2>{s.title}</h2>
      <p>{s.text}</p>
      <div className="row-action">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {last ? (
          <>
            <button ref={nextRef} className="btn primary" onClick={leaveDemo}>
              Start my own
            </button>
            <button className="btn" onClick={onClose}>
              Keep exploring
            </button>
          </>
        ) : (
          <>
            <button ref={nextRef} className="btn primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
            <button className="link-btn" onClick={onClose}>
              Skip tour
            </button>
          </>
        )}
      </div>
    </section>
  );
}
