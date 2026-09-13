export default function BurgrsBanner() {
  return (
    <header className="burgrs-banner">
      <div className="burgrs-banner-overlay" />
      <div className="burgrs-banner-center">
        <img
          src="/burger-rating.png"
          alt="Burger"
          className="burgrs-banner-burger"
        />
        <h1 className="burgrs-banner-title">BURGRS</h1>
      </div>
    </header>
  );
}
