import type { ApprovedKnowledgeBase, SupportedLanguage } from './types.ts';
import { isFilled } from './kb.ts';

export function detectLanguage(text: string, preferred?: SupportedLanguage): SupportedLanguage {
  if (/[\u0C00-\u0C7F]/.test(text)) {
    return 'te';
  }
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }

  const lower = text.toLowerCase();
  const teluguHints = [
    'panti noppi',
    'noppi',
    'entha',
    'ekkada',
    'samayam',
    'kavali',
    'cheppandi',
    'vaidyu',
    'chigullu',
    'telugu',
    'namaskaram',
    'panulu',
  ];
  if (teluguHints.some((h) => lower.includes(h))) {
    return 'te';
  }

  const hindiHints = [
    'daant',
    'dard',
    'kitna',
    'khula',
    'samay',
    'kahan',
    'baje',
    'namaste',
    'ilaj',
    'pata',
    'kya hai',
    'chahiye',
    'masudon',
    'saans',
    'khoon',
    'hindi',
  ];
  if (hindiHints.some((h) => lower.includes(h))) {
    return 'hi';
  }

  if (preferred && (preferred === 'en' || preferred === 'hi' || preferred === 'te')) {
    // Only keep explicit preferred if input is generic punctuation/numbers
    if (/^[0-9+\-\s.,!?]+$/.test(lower)) {
      return preferred;
    }
  }
  return 'en';
}

export function detectEmergency(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns: RegExp[] = [
    /difficulty\s+breathing/i,
    /trouble\s+breathing/i,
    /can'?t\s+breathe/i,
    /cannot\s+breathe/i,
    /shortness\s+of\s+breath/i,
    /difficulty\s+swallowing/i,
    /can'?t\s+swallow/i,
    /uncontrolled\s+bleeding/i,
    /heavy\s+bleeding/i,
    /bleeding\s+won'?t\s+stop/i,
    /severe\s+facial\s+swelling/i,
    /serious\s+facial/i,
    /jaw\s+injury/i,
    /broken\s+jaw/i,
    /loss\s+of\s+consciousness/i,
    /unconscious/i,
    /fainted/i,
    /passed\s+out/i,
    // Hindi & Hinglish
    /सांस\s*लेने\s*में\s*(तकलीफ|दिक्कत|परेशानी|कठिनाई)/,
    /निगलने\s*में\s*(तकलीफ|दिक्कत)/,
    /बेहोश/,
    /ज्यादा\s*खून|लगातार\s*खून/,
    /चेहरे\s*पर\s*(गंभीर|बहुत)\s*सूजन/,
    /saans\s+lene\s+mein\s+(takleef|dikkat)/i,
    /behosh/i,
    // Telugu & Tenglish
    /శ్వాస\s*(తీసుకోవడంలో|ఇబ్బంది|కష్టం)/,
    /మింగడంలో\s*ఇబ్బంది/,
    /రక్తస్రావం|ఆగని\s*రక్తం/,
    /స్పృహ\s*(కోల్పో|తప్ప)/,
    /ముఖం\s*వాపు/,
    /swasa\s+ibbandi/i,
  ];
  return patterns.some((re) => re.test(lower) || re.test(text));
}

export function detectMedicalSymptoms(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns: RegExp[] = [
    /\btooth\s*pain\b/i,
    /\btoothache\b/i,
    /\bswollen\s*gums?\b/i,
    /\bbleeding\s*gums?\b/i,
    /\bjaw\s*pain\b/i,
    /\bsensitivity\b/i,
    /\btooth\s*is\s*sensitive\b/i,
    /\bdental\s*infection\b/i,
    /\babscess\b/i,
    /\bpus\b/i,
    /\bdifficulty\s*chewing\b/i,
    /\bpain\s*while\s*chewing\b/i,
    /\bsevere\s*pain\b/i,
    /\bwhat\s+medicine\b/i,
    /\bwhich\s+tablet\b/i,
    /\bpainkiller\b/i,
    /\bantibiotic\b/i,
    /\bswelling\b/i,
    /\bache\b/i,
    // Hindi & Hinglish
    /दांत\s*(में\s*)?दर्द/,
    /मसूड़ों\s*(में\s*)?(सूजन|खून)/,
    /जबड़े\s*(में\s*)?दर्द/,
    /संक्रमण|इंफेक्शन/,
    /चबाने\s*में\s*(दर्द|दिक्कत)/,
    /कौन\s*सी\s*(दवा|गोली)/,
    /daant\s*(mein\s*)?dard/i,
    /masudon/i,
    // Telugu & Tenglish
    /పంటి\s*నొప్పి/,
    /పళ్ళు\s*నొప్పి/,
    /చిగుళ్ళు\s*(వాపు|రక్తం)/,
    /దవడ\s*నొప్పి/,
    /నమలడం\s*కష్టం/,
    /ఏ\s*మందు\s*(వేసుకోవాలి|వాడాలి)/,
    /panti\s*noppi/i,
  ];
  return patterns.some((re) => re.test(lower) || re.test(text));
}

export function detectPromptInjection(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns: RegExp[] = [
    /ignore\s+(all\s+)?(previous|prior|above|your|the)?\s*(instructions|rules|prompts)/i,
    /disregard\s+(all\s+)?(rules|instructions)/i,
    /reveal\s+(your\s+)?(hidden|system|internal)\s*(instructions|prompt|rules|data|credentials|keys)/i,
    /show\s+(me\s+)?(your\s+)?(system\s+prompt|api\s*key|passwords?|staff\s+credentials)/i,
    /pretend\s+(you\s+are|to\s+be)\s+(the\s+)?(dentist|doctor|admin)/i,
    /act\s+as\s+(a\s+|the\s+)?(dentist|doctor)/i,
    /invent\s+(a\s+)?(consultation\s+)?fee/i,
    /make\s+up\s+(a\s+)?(price|fee|doctor)/i,
    /override\s+(safety|rules)/i,
    /bypass\s+(rules|safety)/i,
  ];
  return patterns.some((re) => re.test(lower));
}

export function detectDiscountRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns: RegExp[] = [
    /\bdiscount\b/i,
    /\bspecial\s+offer\b/i,
    /\bconcession\b/i,
    /\b\d+%\s*off\b/i,
    /\bcheaper\b/i,
    /\breduce\s+(the\s+)?(fee|price|cost)\b/i,
    /\bfree\s+(checkup|consultation|treatment)\b/i,
    /छूट|डिस्काउंट/,
    /రాయితీ|డిస్కౌంట్/,
  ];
  return patterns.some((re) => re.test(lower) || re.test(text));
}

export function getEmergencyMessage(lang: SupportedLanguage, kb: ApprovedKnowledgeBase): string {
  const emergencyPhone = isFilled(kb.settings.emergency_phone) ? kb.settings.emergency_phone : null;
  const clinicPhone = isFilled(kb.settings.phone) ? kb.settings.phone : null;

  if (lang === 'hi') {
    const clinicLine = emergencyPhone
      ? `\n\nक्लिनिक आपातकालीन संपर्क नंबर: ${emergencyPhone}`
      : clinicPhone
        ? `\n\nक्लिनिक फोन नंबर: ${clinicPhone}`
        : '';
    return (
      `आपातकालीन चेतावनी: इसके लिए तुरंत चिकित्सा सहायता की आवश्यकता हो सकती है। कृपया भारत में तुरंत 112 पर आपातकालीन सेवाओं से संपर्क करें या निकटतम इमरजेंसी विभाग में जाएं। चैट उत्तर की प्रतीक्षा न करें।` +
      clinicLine +
      `\n\n(हमारी क्लिनिक टीम को URGENT अलर्ट भेज दिया गया है, लेकिन कृपया इसे आपातकालीन चिकित्सा देखभाल का विकल्प न मानें।)`
    );
  }

  if (lang === 'te') {
    const clinicLine = emergencyPhone
      ? `\n\nక్లినిక్ అత్యవసర నంబర్: ${emergencyPhone}`
      : clinicPhone
        ? `\n\nక్లినిక్ ఫోన్ నంబర్: ${clinicPhone}`
        : '';
    return (
      `అత్యవసర హెచ్చరిక: దీనికి తక్షణ వైద్య సహాయం అవసరం కావచ్చు. దయచేసి భారతదేశంలో వెంటనే 112 అత్యవసర సేవలకు కాల్ చేయండి లేదా సమీపంలోని ఎమర్జెన్సీ విభాగానికి వెళ్ళండి. చాట్ సమాధానం కోసం వేచి ఉండకండి.` +
      clinicLine +
      `\n\n(మా క్లినిక్ సిబ్బందికి URGENT అలర్ట్ పంపబడింది, కానీ ఇది అత్యవసర వైద్య చికిత్సకు ప్రత్యామ్నాయం కాదు.)`
    );
  }

  const clinicLine = emergencyPhone
    ? `\n\nVerified clinic emergency contact: ${emergencyPhone}`
    : clinicPhone
      ? `\n\nClinic phone number: ${clinicPhone}`
      : '';

  return (
    `This may require immediate medical attention. Please contact emergency services on 112 in India or go to the nearest emergency department immediately. Do not wait for a chat response.` +
    clinicLine +
    `\n\nAn URGENT alert has been flagged for our clinic staff, though a clinic ticket is not a substitute for emergency medical care.`
  );
}

export function getSymptomsMessage(lang: SupportedLanguage): string {
  if (lang === 'hi') {
    return 'मुझे खेद है कि आपको तकलीफ हो रही है। मैं दंत चिकित्सक नहीं हूँ और आपकी स्थिति का निदान या दवा की सलाह नहीं दे सकता। दंत चिकित्सक द्वारा जांच आवश्यक है। क्या मैं आपकी अपॉइंटमेंट बुक करने या रिसेप्शनिस्ट से बात कराने में मदद करूँ?';
  }
  if (lang === 'te') {
    return 'మీకు అసౌకర్యంగా ఉన్నందుకు చింతిస్తున్నాను. నేను దంత వైద్యుడిని కాను మరియు మీ పరిస్థితిని నిర్ధారించలేను లేదా మందులు సూచించలేను. దంత వైద్యుడు మిమ్మల్ని పరీక్షించాలి. అపాయింట్‌మెంట్ బుక్ చేయడంలో లేదా రిసెప్షనిస్ట్‌తో మాట్లాడటంలో నేను సహాయం చేయనా?';
  }
  return "I'm sorry you're experiencing discomfort. I'm not a dentist and cannot diagnose your condition. A dentist needs to examine you. Would you like me to help arrange an appointment?";
}

export function getDiscountMessage(lang: SupportedLanguage): string {
  if (lang === 'hi') {
    return 'हमारी परामर्श और उपचार शुल्क क्लिनिक की स्वीकृत मूल्य सूची पर आधारित हैं। मूल्य से जुड़े किसी भी प्रश्न में हमारी टीम आपकी सहायता कर सकती है।';
  }
  if (lang === 'te') {
    return 'మా కన్సల్టేషన్ మరియు చికిత్స ఛార్జీలు క్లినిక్ ఆమోదించిన ధరల ప్రకారం ఉంటాయి. ధరలకు సంబంధించిన ఏవైనా సందేహాలకు మా బృందం మీకు సహాయం చేయగలదు.';
  }
  return "Our consultation and treatment charges are based on the clinic's approved pricing. Our team can help you with any pricing-related questions.";
}

export function getNeedsHumanMessage(lang: SupportedLanguage): string {
  if (lang === 'hi') {
    return 'माफ़ कीजिए, मेरे पास इस बारे में पुष्टि की गई जानकारी नहीं है। हमारी क्लिनिक टीम इसकी जांच करेगी और 2 कार्य घंटों के भीतर आपसे संपर्क करेगी।';
  }
  if (lang === 'te') {
    return 'క్షమించండి, దీని గురించి నా దగ్గర ధృవీకరించబడిన సమాచారం లేదు. మా క్లినిక్ బృందం పరిశీలించి 2 పని గంటల్లో మిమ్మల్ని సంప్రదిస్తుంది.';
  }
  return "I'm sorry, I don't have confirmed information about this. Our clinic team will check and get back to you within 2 working hours.";
}

export function getPromptInjectionRejectionMessage(lang: SupportedLanguage): string {
  if (lang === 'hi') {
    return 'मैं केवल क्लिनिक की स्वीकृत जानकारी, समय, डॉक्टरों और अपॉइंटमेंट अनुरोधों में ही सहायता कर सकता हूँ। मैं क्लिनिक के नियमों को बदल नहीं सकता, न ही आंतरिक जानकारी या मनमानी कीमत बता सकता हूँ।';
  }
  if (lang === 'te') {
    return 'నేను క్లినిక్ ఆమోదించిన సమాచారం, సమయాలు, వైద్యులు మరియు అపాయింట్‌మెంట్ అభ్యర్థనలతో మాత్రమే సహాయం చేయగలను. నేను క్లినిక్ నియమాలను మార్చలేను లేదా అంతర్గత వివరాలను అందించలేను.';
  }
  return 'I can only assist with approved clinic information, timings, doctors, policies, and appointment requests. I cannot override clinic rules, invent prices, or share internal records.';
}

export function getBookingConfirmedMessage(lang: SupportedLanguage): string {
  if (lang === 'hi') {
    return 'धन्यवाद! आपका अपॉइंटमेंट अनुरोध प्राप्त हो गया है। उपलब्ध स्लॉट की पुष्टि करने के लिए हमारी रिसेप्शन टीम आपसे संपर्क करेगी।';
  }
  if (lang === 'te') {
    return 'ధన్యవాదాలు! మీ అపాయింట్‌మెంట్ అభ్యర్థన అందింది. అందుబాటులో ఉన్న సమయాన్ని నిర్ధారించడానికి మా రిసెప్షన్ బృందం మిమ్మల్ని సంప్రదిస్తుంది.';
  }
  return 'Thank you! Your appointment request has been received. Our reception team will contact you to confirm the available slot.';
}

/**
 * Step 8: Validates AI output against strict safety & clinic grounding rules.
 * Rejects any output containing medical advice/drug names, FILL IN leakage, discount promises,
 * or invented monetary numbers not present in the approved KB.
 */
export function validateAiOutput(replyText: string, kb: ApprovedKnowledgeBase): { valid: boolean; reason?: string } {
  if (!replyText || replyText.trim().length < 3) {
    return { valid: false, reason: 'Empty AI response' };
  }

  const lower = replyText.toLowerCase();

  // Never leak placeholder strings as real data
  if (/\bFILL IN\b/i.test(replyText)) {
    return { valid: false, reason: 'Leaked FILL IN placeholder' };
  }

  // Never give medical diagnoses or medication recommendations
  const bannedMedicalTerms = [
    /\bparacetamol\b/i,
    /\bibuprofen\b/i,
    /\bamoxicillin\b/i,
    /\bacetaminophen\b/i,
    /\bdiclo(fenac)?\b/i,
    /\bketorol\b/i,
    /\bmetronidazole\b/i,
    /\bclove oil\b/i,
    /\btake\s+(a\s+)?(painkiller|antibiotic|tablet|medicine|pill)\b/i,
    /\byou\s+(likely|probably)\s+have\s+(a\s+)?(cavity|abscess|pulpitis|gingivitis|infection)\b/i,
  ];
  if (bannedMedicalTerms.some((re) => re.test(lower))) {
    return { valid: false, reason: 'Medical advice or diagnosis detected' };
  }

  // Never promise discounts
  if (/\b(50%|20%|10%|special)\s*(discount|off)\b/i.test(lower) || /we can offer you a discount/i.test(lower)) {
    return { valid: false, reason: 'Unauthorized discount offer' };
  }

  // Check currency amounts mentioned by AI against approved pricing strings
  const kbPricingText = kb.pricing
    .map((p) => `${p.consultation_fee} ${p.treatment_price_range} ${p.additional_charges}`)
    .join(' ');
  const currencyMatches = replyText.match(/(?:₹|Rs\.?|INR)\s*([\d,]+)/gi) || [];
  for (const match of currencyMatches) {
    const digits = match.replace(/[^\d]/g, '');
    if (digits && !kbPricingText.replace(/,/g, '').includes(digits)) {
      return { valid: false, reason: `Unverified price figure ${match} not found in clinic KB` };
    }
  }

  return { valid: true };
}
