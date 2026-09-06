export default async function handler(_request, context) {
  const country = String(context?.geo?.country?.code || "")
    .trim()
    .toUpperCase();

  return new Response(
    JSON.stringify({
      country: /^[A-Z]{2}$/.test(country) ? country : null,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
      },
    }
  );
}
