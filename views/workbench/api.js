export async function fetchWorkbench() {
  const response = await fetch('/api/workbench');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}
