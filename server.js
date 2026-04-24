const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── CONFIG ──
const SUPABASE_URL = 'https://mdxfddbropjwfdvllelc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const MONETBIL_KEY = process.env.MONETBIL_KEY;
const BASE_URL     = process.env.BASE_URL || 'http://localhost:3000';

const supabaseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// ════════════════════════════════
// ROUTES
// ════════════════════════════════

// GET /api/candidats — liste tous les candidats avec leur total de votes
app.get('/api/candidats', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${SUPABASE_URL}/rest/v1/candidats?select=*,votes(montant)`,
      { headers: supabaseHeaders }
    );
    const result = data.map(c => ({
      ...c,
      total_votes: c.votes ? c.votes.length : 0,
      total_montant: c.votes ? c.votes.reduce((s, v) => s + v.montant, 0) : 0
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/initier-vote — initie un paiement Monetbil
app.post('/api/initier-vote', async (req, res) => {
  const { candidat_id, telephone, montant } = req.body;

  if (!candidat_id || !telephone || !montant) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  if (montant < 100) {
    return res.status(400).json({ error: 'Montant minimum : 100 FCFA' });
  }

  try {
    // Crée un enregistrement de vote en attente
    const { data: vote } = await axios.post(
      `${SUPABASE_URL}/rest/v1/votes`,
      { candidat_id, telephone, montant, statut: 'en_attente' },
      { headers: supabaseHeaders }
    );

    const voteId = vote[0].id;

    // Lance le paiement Monetbil
    const monetbilRes = await axios.post(
      'https://api.monetbil.com/payment/v1/placePayment',
      null,
      {
        params: {
          service: MONETBIL_KEY,
          phonenumber: telephone,
          amount: montant,
          payment_ref: voteId,
          notify_url: `${BASE_URL}/api/monetbil-webhook`,
          return_url: `${BASE_URL}/vote-confirme.html?ref=${voteId}`,
        }
      }
    );

    res.json({
      success: true,
      vote_id: voteId,
      payment_url: monetbilRes.data.payment_url || null,
      message: `Une demande de paiement de ${montant} FCFA a été envoyée au ${telephone}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/monetbil-webhook — Monetbil notifie après paiement
app.post('/api/monetbil-webhook', async (req, res) => {
  const { payment_ref, status, transaction_id } = req.body;

  if (!payment_ref) return res.sendStatus(400);

  const statut = status === 'success' ? 'confirme' : 'echec';

  try {
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/votes?id=eq.${payment_ref}`,
      { statut, transaction_id: transaction_id || null },
      { headers: supabaseHeaders }
    );
    res.sendStatus(200);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resultats — classement en temps réel
app.get('/api/resultats', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${SUPABASE_URL}/rest/v1/candidats?select=id,nom,categorie,cat_label,niveau,photo_url,votes(montant)&votes.statut=eq.confirme`,
      { headers: supabaseHeaders }
    );
    const result = data
      .map(c => ({
        id: c.id,
        nom: c.nom,
        categorie: c.categorie,
        cat_label: c.cat_label,
        niveau: c.niveau,
        photo_url: c.photo_url,
        nb_votes: c.votes ? c.votes.length : 0,
        montant_total: c.votes ? c.votes.reduce((s, v) => s + v.montant, 0) : 0
      }))
      .sort((a, b) => b.nb_votes - a.nb_votes);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vote-status/:id — vérifie le statut d'un vote
app.get('/api/vote-status/:id', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${SUPABASE_URL}/rest/v1/votes?id=eq.${req.params.id}&select=*`,
      { headers: supabaseHeaders }
    );
    if (!data.length) return res.status(404).json({ error: 'Vote introuvable' });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── START ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur ESS Grand Talent actif sur le port ${PORT}`));
