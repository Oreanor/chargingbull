import { motion } from 'motion/react';
import { useSlotProgress } from '../engine/useSlotProgress';

/**
 * Crossfades a list of images according to the parent Stage's scroll progress.
 * Image i is fully visible when progress is in the i-th equal slice of [0,1].
 */
export default function ImageCrossfade({
  images,
  alt = '',
  className = '',
}: {
  images: string[];
  alt?: string;
  className?: string;
}) {
  return (
    <div className={`relative w-full h-full ${className}`}>
      {images.map((src, i) => (
        <Layer key={src} src={src} alt={alt} index={i} count={images.length} />
      ))}
    </div>
  );
}

function Layer({
  src,
  alt,
  index,
  count,
}: {
  src: string;
  alt: string;
  index: number;
  count: number;
}) {
  const { opacity } = useSlotProgress(index, count);
  return (
    <motion.img
      src={src}
      alt={alt}
      style={{ opacity }}
      className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
    />
  );
}
