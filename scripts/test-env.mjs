for (const key of Object.keys(process.env)) {
  if (key.startsWith("TURSO_") || key.startsWith("STRIPE_")) delete process.env[key];
}
