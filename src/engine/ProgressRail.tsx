import { useScroll, useSpring, motion } from 'motion/react';

export default function ProgressRail() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30, mass: 0.2 });

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-white/5 pointer-events-none">
      <motion.div
        style={{ scaleX, transformOrigin: '0 0' }}
        className="h-full bg-gradient-to-r from-gold to-accent"
      />
    </div>
  );
}
