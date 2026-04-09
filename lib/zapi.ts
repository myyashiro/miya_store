const INSTANCE_ID = process.env.ZAPI_INSTANCE_ID!;
const TOKEN = process.env.ZAPI_TOKEN!;
const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!;
const BASE_URL = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`;

const headers = {
  'Content-Type': 'application/json',
  'Client-Token': CLIENT_TOKEN,
};

export async function sendTextToGroup(groupId: string, message: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/send-text`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone: groupId, message }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Z-API error: ${res.status} ${err}`);
  }
}

export async function sendImageToGroup(groupId: string, imageUrl: string, caption: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/send-image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone: groupId, image: imageUrl, caption }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Z-API error: ${res.status} ${err}`);
  }
}
