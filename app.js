/* ---------- Réglages ---------- */
var DEFAULT_AMOUNT = 700000;
var DEADLINE = new Date(2027, 2, 1); // 1er mars 2027

// Liste des membres du groupe (pour les listes déroulantes « Mon prénom »)
var MEMBERS = [
  'Thierno Amadou',
  'Abdoulaye Souleymane',
  'Thierno Hamidou',
  'Karim',
  'Fadja',
  'Djouldé',
  'Yassar',
  'Oumar',
  'Chérif'
];

/* ---------- Données (elles viennent de Supabase) ---------- */
var sb = null; // client Supabase

var state = {
  tab: 'infos',
  phone: '',
  payers: [],   // { name, amount, url }
  votes: [],    // { name, amount }
  remarks: []   // { author, text }
};
var ui = { flash: '', error: '', busy: false };

function configured() {
  return typeof SUPABASE_URL === 'string' && SUPABASE_URL.indexOf('https://') === 0 &&
    typeof SUPABASE_KEY === 'string' && SUPABASE_KEY.length > 20 && SUPABASE_KEY.indexOf('COLLE_ICI') === -1;
}

function check(res) {
  if (res && res.error) throw res.error;
  return res;
}

// Recharge toutes les données depuis Supabase
function refresh() {
  return Promise.all([
    sb.from('reglages').select('numero_orange_money').eq('id', 1).maybeSingle(),
    sb.from('paiements').select('prenom,montant,capture_url').order('created_at', { ascending: true }),
    sb.from('votes').select('prenom,montant').order('created_at', { ascending: true }),
    sb.from('remarques').select('auteur,texte').order('created_at', { ascending: false })
  ]).then(function (r) {
    r.forEach(function (x) { check(x); });
    state.phone = (r[0].data && r[0].data.numero_orange_money) || '';
    state.payers = r[1].data.map(function (p) { return { name: p.prenom, amount: p.montant, url: p.capture_url }; });
    state.votes = r[2].data.map(function (v) { return { name: v.prenom, amount: v.montant }; });
    state.remarks = r[3].data.map(function (x) { return { author: x.auteur, text: x.texte }; });
  });
}

// Met la page à jour quand quelqu'un d'autre vote, paie ou écrit
function listen() {
  var timer = null;
  sb.channel('changements')
    .on('postgres_changes', { event: '*', schema: 'public' }, function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (ui.busy) return;
        refresh().then(function () { render(true); }).catch(function () {});
      }, 300);
    })
    .subscribe();
}

// Lance une action (envoi vers Supabase) avec un bouton qui montre l'attente
function run(btn, work, flash) {
  if (ui.busy) return;
  ui.busy = true;
  btn.disabled = true;
  btn.textContent = 'Envoi en cours…';
  var ok = false;
  work()
    .then(function () { return refresh(); })
    .then(function () { ok = true; ui.flash = flash; ui.error = ''; })
    .catch(function (e) { ui.flash = ''; ui.error = (e && e.message) ? e.message : 'Une erreur est survenue.'; })
    .then(function () { ui.busy = false; render(!ok); });
}

/* ---------- Outils ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function nameSelect(id) {
  return '<select id="' + id + '" style="margin-top:6px">' +
    '<option value="">Choisis ton prénom</option>' +
    MEMBERS.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('') +
    '</select>';
}
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function digits(s) { return String(s).replace(/\D/g, ''); }

// Les montants proposés se déduisent des votes
function options() {
  var map = {};
  state.votes.forEach(function (v) {
    if (!map[v.amount]) map[v.amount] = [];
    map[v.amount].push(v.name);
  });
  return Object.keys(map).map(function (k) {
    return { amount: Number(k), names: map[k] };
  }).sort(function (a, b) { return a.amount - b.amount; });
}
function winner() {
  var total = state.votes.length;
  var list = options();
  for (var i = 0; i < list.length; i++) {
    if (list[i].names.length * 2 > total) return list[i];
  }
  return null;
}
function currentAmount() { var w = winner(); return w ? w.amount : DEFAULT_AMOUNT; }

// Somme des montants déclarés par les membres
function totalPaid() {
  return state.payers.reduce(function (sum, p) { return sum + (p.amount || 0); }, 0);
}

function daysLeft() {
  var d = Math.ceil((DEADLINE - new Date()) / 86400000);
  if (d > 1) return 'Dans ' + d + ' jours';
  if (d === 1) return 'Demain';
  if (d === 0) return 'Aujourd’hui';
  return 'Date passée';
}

/* ---------- Affichage ---------- */
var TABS = [
  { id: 'infos', label: 'Infos' },
  { id: 'paiements', label: 'Paiements' },
  { id: 'vote', label: 'Vote' },
  { id: 'remarques', label: 'Remarques' }
];

function renderNav() {
  $('nav').innerHTML = TABS.map(function (t) {
    return '<button class="' + (state.tab === t.id ? 'on' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
  }).join('');
}

function viewInfos() {
  var w = winner();
  var note = (w && w.amount !== DEFAULT_AMOUNT)
    ? 'Mis à jour par le vote du groupe, à la majorité.'
    : '';
  var phoneBlock = state.phone
    ? '<div><div style="font-size:15px;line-height:22px">Par Orange Money sur ce numéro :</div>' +
      '<div style="font-size:20px;font-weight:700;letter-spacing:.02em">' + esc(state.phone) + '</div></div>'
    : '<div class="muted">Aucun numéro renseigné pour l’instant.</div>';

  return '' +
    '<div class="card hero">' +
      '<div style="font-size:13px;font-weight:500">Cotisation par personne l’année dernière</div>' +
      '<div class="big">' + fmt(currentAmount()) + ' FG</div>' +
      '<p>' + note + '</p>' +
      '<p>À voter si la somme est différente cette année.<p>' +
      '<button class="btn ghost" data-go="vote">Aller au vote</button>' +
    '</div>' +

    '<div class="card"><div class="row between">' +
      '<div><div class="muted" style="font-size:13px">Date limite d’envoi</div>' +
      '<div style="font-size:18px;font-weight:700">15 février 2027</div></div>' +
      '<span class="pill amber">' + daysLeft() + '</span>' +
    '</div></div>' +

    '<div class="card">' +
      '<div class="muted" style="font-size:13px">Où envoyer l’argent</div>' +
      phoneBlock +
      '<div><label class="label" for="tel">Changer le numéro</label>' +
'<input id="tel" type="tel" inputmode="tel" placeholder="+224 ..." value="' + '" style="margin-top:6px"></div>' +
'<button class="btn full" id="phoneBtn">Valider le numéro</button>' +
(ui.flash === 'phone' ? '<div class="ok">Le numéro est enregistré.</div>' : '') +
'<div class="muted">Une fois l’argent envoyé, partage une capture d’écran dans l’onglet Paiements pour que le transfert soit notifié.</div>'+
'</div>' +
    '<div class="card">' +
      '<div class="label">Après le 15 février, à prévoir si necéssaire</div>' +
      '<div class="steps">' +
        '<div class="step"><div class="num">1</div><span>Devis estimatif des achats de denrées alimentaires.</span></div>' +
        '<div class="step"><div class="num">2</div><span>Vote d’une somme à donner à l’une des familles du groupe. La famille de Karim a été choisie à l’unanimité l’année dernière.</span></div>' +
      '</div>' +
    '</div>' +

    '<div class="muted center">Qu’Allah accepte nos sacrifices et notre jeûne.</div>';
}

function viewPaiements() {
  var count = state.payers.length;
  var list = count
    ? state.payers.map(function (p) {
        var link = (p.url && /^https:\/\//.test(p.url))
          ? '<div><a class="link" href="' + esc(p.url) + '" target="_blank" rel="noopener">Voir la capture</a></div>'
          : '';
        return '<div class="item flex"><div><b>' + esc(p.name) + '</b>' +
          '<div class="muted" style="font-size:13px">' + fmt(p.amount) + ' FG</div>' + link + '</div>' +
          '<span class="pill">Payé</span></div>';
      }).join('')
    : '<div class="empty">Personne n’a encore signalé son envoi.</div>';

  return '' +
    '<div class="card hero" style="padding:16px;">' +
      '<div style="font-size:13px;font-weight:500">État des cotisations</div>' +
      '<div class="big" style="font-size:24px;line-height:30px;">' + count + (count > 1 ? ' personnes ont payés' : ' personne a payé') + '</div>' +
      '<p>Total déclaré : ' + fmt(totalPaid()) + ' FG</p>' +
    '</div>' +

    '<div class="card">' +
      '<div class="label">J’ai envoyé ma cotisation</div>' +
      '<div><label class="muted" for="payName" style="font-size:13px">Mon prénom</label>' +
      nameSelect('payName') + '</div>' +
      '<div><label class="muted" for="payAmount" style="font-size:13px">Montant envoyé (FG)</label>' +
      '<input id="payAmount" type="text" inputmode="numeric" placeholder="Ex. 700000" style="margin-top:6px"></div>' +
      '<div><label class="muted" for="payFile" style="font-size:13px">Capture d’écran du transfert</label>' +
      '<label class="file-upload-btn" style="margin-top:6px">' +
        '<input id="payFile" type="file" accept="image/*">' +
        '<span id="fileLabel">📁 <b>Clique ici pour joindre la capture</b></span>' +
      '</label></div>' +
      '<button class="btn full" id="payBtn" disabled>Prévenir le groupe</button>' +
      (ui.flash === 'pay' ? '<div class="ok">Merci, ton envoi est noté dans la liste.</div>' : '') +
    '</div>' +

    '<div class="label" style="margin-top:4px">Liste des membres</div>' +
    '<div class="remarks-container">' + list + '</div>';
}

function viewVote() {
  var total = state.votes.length;
  var w = winner();
  var list = options();
  var opts = list.map(function (o) {
    var c = o.names.length;
    var pct = total ? Math.round(c / total * 100) : 0;
    return '<button class="option" data-amount="' + o.amount + '">' +
      '<div class="top"><span class="amt">' + fmt(o.amount) + ' FG</span><span class="cnt">' + c + (c > 1 ? ' votes' : ' vote') + ' · ' + pct + ' %</span></div>' +
      '<div class="who">Votants : ' + esc(o.names.join(', ')) + '</div>' +
      '<div class="bar"><div style="width:' + pct + '%"></div></div>' +
    '</button>';
  }).join('');

  var lead = 'Aucun vote pour l’instant.';
  if (total > 0) {
    var max = Math.max.apply(null, list.map(function (o) { return o.names.length; }));
    var leaders = list.filter(function (o) { return o.names.length === max; });
    lead = leaders.length === 1 ? 'En tête : ' + fmt(leaders[0].amount) + ' FG' : 'Égalité pour l’instant';
  }
  var majority = w
    ? 'Majorité atteinte : ' + fmt(w.amount) + ' FG est le montant affiché dans Infos.'
    : 'Pas encore de majorité : le montant reste à ' + fmt(DEFAULT_AMOUNT) + ' FG.';

  return '' +
    '<div><div class="eyebrow">Vote</div><h2 style="margin:4px 0 6px">Quelle cotisation par personne pour 2027 ?</h2>' +
    '<p class="muted" style="margin:0">Indique ton prénom et le montant que tu proposes (tape-le, ou touche un montant déjà proposé), puis vote. Un seul vote par prénom : si tu revotes, ton choix est remplacé.</p></div>' +
    (opts
      ? '<div style="display:flex;flex-direction:column;gap:10px">' + opts + '</div>'
      : '<div class="empty">Aucun vote pour l’instant. Le premier vote créera le premier montant.</div>') +

    '<div class="card">' +
      '<div><label class="label" for="voter">Mon prénom</label>' +
      nameSelect('voter') + '</div>' +
      '<div><label class="label" for="custom">Montant que je propose (FG)</label>' +
      '<input id="custom" type="text" inputmode="numeric" placeholder="Ex. 700000" style="margin-top:6px"></div>' +
      '<button class="btn full" id="voteBtn" disabled>Voter</button>' +
      (ui.flash === 'vote' ? '<div class="ok">Merci, ton vote est enregistré.</div>' : '') +
    '</div>' +

    '<div class="row between label"><span>' + lead + '</span><span>' + total + ' au total</span></div>' +
    '<div class="muted" style="font-size:13px">' + majority + '</div>';
}

function viewRemarques() {
  var list = state.remarks.length
    ? state.remarks.map(function (r) {
        return '<div class="item">' +
          '<div class="label" style="margin-bottom:4px">' + esc(r.author) + '</div>' +
          esc(r.text) + '</div>';
      }).join('')
    : '<div class="empty">Aucune remarque pour l’instant.</div>';
  return '' +
    '<p class="muted" style="margin:0">Un point oublié dans le compte rendu ? Une correction ? Ajoute-le ici pour que tout le groupe le voie.</p>' +
    '<div><label class="label" for="remarkAuthor">Mon prénom</label>' +
    nameSelect('remarkAuthor') + '</div>' +
    '<div><label class="label" for="remark">Ton ajout ou ta correction</label>' +
    '<textarea id="remark" placeholder="Ex. Il faudrait aussi préciser..." style="margin-top:8px"></textarea></div>' +
    '<button class="btn full" id="remarkBtn" disabled>Ajouter au compte rendu</button>' +
    '<div class="label" style="margin-top:4px">Remarques du groupe</div>' +
    '<div class="remarks-container">' + list + '</div>';
}

function viewSetup() {
  return '<div class="card"><div class="label">Supabase n’est pas encore branché</div>' +
    '<div class="muted">Ouvre le fichier <b>config.js</b> et colle l’URL du projet et la clé « anon public », puis recharge la page.</div></div>';
}

/* ---------- Affichage de la page (en gardant ce que la personne est en train de saisir) ---------- */
var FORM_IDS = ['tel', 'payName', 'payAmount', 'voter', 'custom', 'remarkAuthor', 'remark'];
function snapshot() {
  var s = { values: {}, file: $('payFile'), fileLabel: $('fileLabel') ? $('fileLabel').textContent : '', focus: null };
  FORM_IDS.forEach(function (id) { if ($(id)) s.values[id] = $(id).value; });
  var a = document.activeElement;
  if (a && a.id) {
    s.focus = a.id;
    try { s.start = a.selectionStart; s.end = a.selectionEnd; } catch (e) {}
  }
  return s;
}
function restore(s) {
  FORM_IDS.forEach(function (id) { if ($(id) && s.values[id] !== undefined) $(id).value = s.values[id]; });
  if (s.file && $('payFile')) {
    $('payFile').parentNode.replaceChild(s.file, $('payFile'));
    $('fileLabel').textContent = s.fileLabel;
  }
  if (s.focus && $(s.focus)) {
    $(s.focus).focus();
    try { $(s.focus).setSelectionRange(s.start, s.end); } catch (e) {}
  }
}

function render(keep) {
  var snap = keep ? snapshot() : null;
  var views = { infos: viewInfos, paiements: viewPaiements, vote: viewVote, remarques: viewRemarques };
  var banner = ui.error ? '<div class="error">' + esc(ui.error) + '</div>' : '';
  $('main').innerHTML = banner + (sb ? views[state.tab]() : viewSetup());
  if (snap) restore(snap);
  renderNav();
  if (sb) bind();
}

/* ---------- Interactions ---------- */
// Met à jour le bouton « Voter » et la surbrillance du montant choisi
function syncVote() {
  var amt = parseInt(digits($('custom').value), 10) || 0;
  $('voteBtn').disabled = !($('voter').value && amt > 0);
  var cards = document.querySelectorAll('[data-amount]');
  for (var i = 0; i < cards.length; i++) {
    var same = parseInt(cards[i].getAttribute('data-amount'), 10) === amt;
    cards[i].className = same ? 'option on' : 'option';
  }
}

function bind() {
  var go = document.querySelector('[data-go]');
  if (go) go.onclick = function () { setTab('vote'); };

  // Numéro Orange Money (
if ($('tel')) {
  var checkPhone = function () {
    $('phoneBtn').disabled = digits($('tel').value).length < 8;
  };

  $('tel').oninput = checkPhone;
  checkPhone();

$('phoneBtn').onclick = function () {
  var v = $('tel').value.trim();

  if (digits(v).length < 8) return;

  run(this, function () {
    return sb
      .from('reglages')
      .upsert({
        id: 1,
        numero_orange_money: v
      })
      .select()
      .then(function (res) {
        console.log('UPDATE REGLAGES', res);

        if (res.error) {
          throw res.error;
        }

        // mise à jour de l'affichage
        state.phone = v;

        // vide le champ
        $('tel').value = '';

        return res;
      });
  }, 'phone');
};
}

  // Paiements
  if ($('payName')) {
    var checkPay = function () {
      var amt = parseInt(digits($('payAmount').value), 10) || 0;
      $('payBtn').disabled = !($('payName').value && amt > 0 && $('payFile').files.length);
    };
    $('payName').onchange = checkPay;
    $('payAmount').oninput = checkPay;
    $('payFile').onchange = function () {
      var f = $('payFile').files[0];
      $('fileLabel').textContent = f ? 'Capture jointe : ' + f.name : 'Aucune capture jointe.';
      checkPay();
    };
    checkPay();
    $('payBtn').onclick = function () {
      var nm = $('payName').value;
      var f = $('payFile').files[0];
      var amt = parseInt(digits($('payAmount').value), 10) || 0;
      if (!nm || !f || amt <= 0) return;
      if (f.size > 5 * 1024 * 1024) {
        ui.error = 'L’image est trop lourde (5 Mo maximum).';
        render(true);
        return;
      }
      run(this, function () {
        var path = Date.now() + '-' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        return sb.storage.from('captures').upload(path, f, { contentType: f.type }).then(check).then(function () {
          var url = sb.storage.from('captures').getPublicUrl(path).data.publicUrl;
          return sb.from('paiements').upsert({ prenom: nm, montant: amt, capture_url: url }, { onConflict: 'prenom' }).then(check);
        });
      }, 'pay');
    };
  }

  // Vote
  if ($('voter')) {
    // Toucher un montant déjà proposé le recopie dans le champ
    var cards = document.querySelectorAll('[data-amount]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].onclick = function () {
        $('custom').value = this.getAttribute('data-amount');
        ui.flash = '';
        syncVote();
      };
    }
    $('voter').onchange = syncVote;
    $('custom').oninput = syncVote;
    syncVote();
    $('voteBtn').onclick = function () {
      var nm = $('voter').value;
      var amt = parseInt(digits($('custom').value), 10) || 0;
      if (!nm || amt <= 0) return;
      run(this, function () {
        return sb.from('votes').upsert({ prenom: nm, montant: amt }, { onConflict: 'prenom' }).then(check);
      }, 'vote');
    };
  }

  // Remarques
  if ($('remark')) {
    var checkRemark = function () {
      $('remarkBtn').disabled = !($('remark').value.trim() && $('remarkAuthor').value);
    };
    $('remark').oninput = checkRemark;
    $('remarkAuthor').onchange = checkRemark;
    checkRemark();
    $('remarkBtn').onclick = function () {
      var t = $('remark').value.trim();
      var who = $('remarkAuthor').value;
      if (!t || !who) return;
      run(this, function () {
        return sb.from('remarques').insert({ auteur: who, texte: t }).then(check);
      }, '');
    };
  }
}

function setTab(t) { state.tab = t; ui.flash = ''; ui.error = ''; render(); window.scrollTo(0, 0); }

$('nav').addEventListener('click', function (e) {
  var t = e.target.getAttribute('data-tab');
  if (t) setTab(t);
});

/* ---------- Démarrage ---------- */
if (configured() && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  $('main').innerHTML = '<div class="muted">Chargement…</div>';
  renderNav();
  refresh()
    .then(function () { render(); listen(); })
    .catch(function (e) {
      ui.error = 'Connexion impossible : ' + ((e && e.message) || 'vérifie config.js et le script SQL.');
      render();
    });
} else {
  if (configured()) ui.error = 'La librairie Supabase n’a pas pu se charger. Vérifie ta connexion internet.';
  state.tab = 'infos';
  render();
}
