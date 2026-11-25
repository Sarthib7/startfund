for (const key of Object.keys(process.env)) {
  if (key.startsWith("TURSO_")) delete process.env[key];
}
