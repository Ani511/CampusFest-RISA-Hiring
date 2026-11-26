import { handleChat, type ApiRequest, type ApiResponse } from '../server/chatRoutes.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ status: 405, error: 'Method not allowed.' });
    return;
  }
  await handleChat(req, res);
}
