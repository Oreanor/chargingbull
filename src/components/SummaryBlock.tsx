/**
 * SummaryBlock — a full-width credits / acknowledgements band before the footer
 * (summary-block design). Dark band, struve type. NOTE: the design SVG carried
 * placeholder copy from another project — the text below is a best-effort fit for
 * this piece (Shiller/Yale data, Datum splat, Mapbox); replace with the final copy.
 */
export function SummaryBlock() {
  return (
    <section
      className="w-full bg-[#292929] text-[#D6D6D6] px-6 md:px-[97px] py-16"
      style={{ fontFamily: 'var(--font-struve)' }}
    >
      <div className="max-w-[1246px] mx-auto text-[clamp(14px,1.1vw,18px)] leading-[1.55] space-y-5">
        <p>
          <b className="text-white">Credits</b>: Research, editing, design, illustrations,
          visualisations and layout by M&eacute;ridien. Data sources: KAPSARC Data Portal,
          General Authority for Statistics, Pew Research Center, Open-Meteo. Map engine: U
          Maps. Photos: Hasan Hatrash, Dunia Production Company/Shutterstock. Video:
          ahmad.faizal/Shutterstock.
        </p>
        <p>
          <b className="text-white">Acknowledgements</b>: We would like to thank the Balady
          team for their support and contributions to this project.
        </p>
      </div>
    </section>
  );
}
