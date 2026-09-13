export default function BurgrsBanner() {
  return (
    <header className="burgrs-banner">
      <div className="burgrs-banner-overlay" />
      <div className="burgrs-banner-center">
        <img
          src="/burgrs-header-logo-v2.webp"
          alt="BURGRS TV"
          className="burgrs-banner-burger"
          style={{
            position: "relative",
            width: "64px",
            height: "auto",
            maxHeight: "80%",
            opacity: 1,
            filter: "drop-shadow(0 4px 10px rgba(0, 0, 0, 0.28))",
          }}
        />
      </div>
    </header>
  );
}
