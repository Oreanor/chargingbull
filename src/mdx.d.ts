declare module '*.mdx' {
  import type { MDXProps } from 'mdx/types';
  import type { ComponentType } from 'react';
  const MDXComponent: ComponentType<MDXProps>;
  export default MDXComponent;
}
