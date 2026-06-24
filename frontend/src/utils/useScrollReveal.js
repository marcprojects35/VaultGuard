import { useEffect, useRef } from 'react';

export function useScrollReveal(options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-visible');
          observer.unobserve(el);
        }
      },
      {
        threshold: options.threshold ?? 0.08,
        rootMargin: options.rootMargin ?? '0px 0px -40px 0px',
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

export function useStaggerReveal(count = 8, options = {}) {
  const refs = Array.from({ length: count }, () => useRef(null));

  useEffect(() => {
    const observers = refs.map((ref, i) => {
      const el = ref.current;
      if (!el) return null;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setTimeout(() => el.classList.add('is-visible'), i * 60);
            observer.unobserve(el);
          }
        },
        { threshold: 0.06, rootMargin: '0px 0px -30px 0px', ...options }
      );

      observer.observe(el);
      return observer;
    });

    return () => observers.forEach(o => o?.disconnect());
  }, []);

  return refs;
}
