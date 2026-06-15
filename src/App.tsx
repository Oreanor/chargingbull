import Longread from './engine/Longread';
import ChargingBull from './content/charging-bull.mdx';
import { mdxComponents } from './content/mdx-components';

export default function App() {
  return (
    <Longread>
      <ChargingBull components={mdxComponents} />
    </Longread>
  );
}
