import type { ApprovedKnowledgeBase, SupportedLanguage, TicketCategory } from './types.ts';
import { isFilled } from './kb.ts';

export interface FallbackResult {
  matched: boolean;
  reply: string;
  sourceLabel: string | null;
  needsHuman: boolean;
  ticketCategory: TicketCategory;
  handoverRequested?: boolean;
}

function formatTimingsText(kb: ApprovedKnowledgeBase, lang: SupportedLanguage): string | null {
  const { opening_time, closing_time, working_days, sunday_hours, lunch_break, public_holiday_note, holidays } =
    kb.settings;
  if (!isFilled(opening_time) || !isFilled(closing_time)) {
    return null;
  }
  const days = working_days.length > 0 ? working_days.join(', ') : 'Monday to Saturday';
  const extras: string[] = [];
  if (isFilled(sunday_hours)) extras.push(`Sunday: ${sunday_hours}`);
  if (isFilled(lunch_break)) extras.push(`Lunch break: ${lunch_break}`);
  if (isFilled(public_holiday_note)) extras.push(`Public holidays: ${public_holiday_note}`);
  if (holidays.length > 0) extras.push(`Scheduled holidays: ${holidays.join(', ')}`);

  const extraStr = extras.length > 0 ? `\n${extras.join(' · ')}` : '';

  if (lang === 'hi') {
    return `हमारा क्लिनिक ${days} को सुबह ${opening_time} से ${closing_time} तक खुला रहता है।${extraStr}`;
  }
  if (lang === 'te') {
    return `మా క్లినిక్ ${days} రోజులలో ${opening_time} నుండి ${closing_time} వరకు తెరిచి ఉంటుంది.${extraStr}`;
  }
  return `Our clinic is open on ${days} from ${opening_time} to ${closing_time}.${extraStr}`;
}

function formatLocationText(kb: ApprovedKnowledgeBase, lang: SupportedLanguage): string | null {
  const { clinic_name, address, landmark, maps_link, phone, whatsapp, parking } = kb.settings;
  if (!isFilled(address)) {
    return null;
  }
  const namePart = isFilled(clinic_name) ? clinic_name : 'Our dental clinic';
  const landmarkPart = isFilled(landmark) ? ` Landmark: ${landmark}.` : '';
  const mapPart = isFilled(maps_link) ? ` Google Maps: ${maps_link}.` : '';
  const phonePart = isFilled(phone) ? ` Phone: ${phone}.` : '';
  const waPart = isFilled(whatsapp) ? ` WhatsApp: ${whatsapp}.` : '';
  const parkingPart = isFilled(parking) ? ` Parking: ${parking}.` : '';

  if (lang === 'hi') {
    return `${namePart} का पता: ${address}।${landmarkPart}${mapPart}${phonePart}${waPart}${parkingPart}`;
  }
  if (lang === 'te') {
    return `${namePart} చిరునామా: ${address}.${landmarkPart}${mapPart}${phonePart}${waPart}${parkingPart}`;
  }
  return `${namePart} is located at: ${address}.${landmarkPart}${mapPart}${phonePart}${waPart}${parkingPart}`;
}

export function runFallbackEngine(
  message: string,
  lang: SupportedLanguage,
  kb: ApprovedKnowledgeBase
): FallbackResult {
  const lower = message.toLowerCase();

  // 1. Human / receptionist handover explicit request
  const wantsHuman =
    /\b(talk to|speak to|connect me|human|receptionist|staff|agent|call me)\b/i.test(lower) ||
    /रिसेप्शनिस्ट|इंसान|स्टाफ\s*से\s*बात/.test(message) ||
    /రిసెప్షనిస్ట్|సిబ్బందితో\s*మాట్లాడ/.test(message);

  if (wantsHuman) {
    const reply =
      lang === 'hi'
        ? 'मैंने आपका अनुरोध हमारे क्लिनिक रिसेप्शनिस्ट को भेज दिया है। हमारी टीम 2 कार्य घंटों के भीतर आपसे संपर्क करेगी।'
        : lang === 'te'
          ? 'మీ అభ్యర్థనను మా క్లినిక్ రిసెప్షనిస్ట్‌కు పంపించాను. మా బృందం 2 పని గంటల్లో మిమ్మల్ని సంప్రదిస్తుంది.'
          : 'I have forwarded your conversation to our clinic receptionist. A team member will respond here or reach out within 2 working hours.';
    return {
      matched: true,
      reply,
      sourceLabel: null,
      needsHuman: true,
      ticketCategory: 'Other',
      handoverRequested: true,
    };
  }

  // 2. Parking specific enquiry
  if (/\b(parking|park|basement|car|bike)\b/i.test(lower)) {
    if (isFilled(kb.settings.parking)) {
      return {
        matched: true,
        reply: kb.settings.parking,
        sourceLabel: 'Answered from the clinic file',
        needsHuman: false,
        ticketCategory: 'Other',
      };
    }
    return { matched: false, reply: '', sourceLabel: null, needsHuman: true, ticketCategory: 'Missing clinic information' };
  }

  // 3. Clinic timings / hours / lunch break / sunday / holiday
  const asksTimings =
    /\b(timing|timings|hours|open|opening|close|closing|schedule|working\s*days?|holiday|holidays|sunday|saturday|lunch)\b/i.test(
      lower
    ) ||
    /समय|कब\s*खुल|कब\s*बंद|कितने\s*बजे|छुट्टी|टाइमिंग|रविवार|लंच/.test(message) ||
    /సమయం|టైమింగ్స్|ఎప్పుడు\s*తెర|ఎప్పుడు\s*మూ|సెలవు|ఆదివారం/.test(message) ||
    /samayam|enni gantala/i.test(lower);

  if (asksTimings) {
    const text = formatTimingsText(kb, lang);
    if (text) {
      return {
        matched: true,
        reply: text,
        sourceLabel: 'Answered from the clinic file',
        needsHuman: false,
        ticketCategory: 'Missing clinic information',
      };
    }
    return {
      matched: false,
      reply: '',
      sourceLabel: null,
      needsHuman: true,
      ticketCategory: 'Missing clinic information',
    };
  }

  // 4. Location / address / landmark / maps / contact
  const asksLocation =
    /\b(address|location|where|directions?|landmark|google\s*maps?|banjara|hyderabad|phone|contact|whatsapp|email|number)\b/i.test(
      lower
    ) ||
    /पता|कहां|लोकेशन|फोन|नंबर|संपर्क|ईमेल/.test(message) ||
    /చిరునామా|ఎక్కడ|లొకేషన్|ఫోన్|నంబర్|సంప్రదించ/.test(message) ||
    /address|ekkada/i.test(lower);

  if (asksLocation) {
    const text = formatLocationText(kb, lang);
    if (text) {
      return {
        matched: true,
        reply: text,
        sourceLabel: 'Answered from the clinic file',
        needsHuman: false,
        ticketCategory: 'Missing clinic information',
      };
    }
    if (/\b(phone|contact|whatsapp|email|number)\b/i.test(lower)) {
      const parts: string[] = [];
      if (isFilled(kb.settings.phone)) parts.push(`Phone: ${kb.settings.phone}`);
      if (isFilled(kb.settings.whatsapp)) parts.push(`WhatsApp: ${kb.settings.whatsapp}`);
      if (isFilled(kb.settings.email)) parts.push(`Email: ${kb.settings.email}`);
      if (parts.length > 0) {
        return {
          matched: true,
          reply: `You can reach the clinic via ${parts.join(', ')}.`,
          sourceLabel: 'Answered from the clinic file',
          needsHuman: false,
          ticketCategory: 'Missing clinic information',
        };
      }
    }
    return {
      matched: false,
      reply: '',
      sourceLabel: null,
      needsHuman: true,
      ticketCategory: 'Missing clinic information',
    };
  }

  // 5. Doctors enquiry (or children/paediatric doctor)
  const asksDoctors =
    /\b(doctor|doctors|dentist|dentists|specialist|orthodontist|paediatric|pediatric|dr\.?)\b/i.test(lower) ||
    /डॉक्टर|चिकित्सक/.test(message) ||
    /డాక్టర్|వైద్యు/.test(message);

  if (asksDoctors) {
    if (kb.doctors.length === 0) {
      return {
        matched: false,
        reply: '',
        sourceLabel: null,
        needsHuman: true,
        ticketCategory: 'Doctor enquiry',
      };
    }
    const doctorLines = kb.doctors.map((d) => {
      const qual = isFilled(d.qualifications) ? ` (${d.qualifications})` : '';
      const spec = isFilled(d.specialisation) ? ` — ${d.specialisation}` : '';
      const days = isFilled(d.available_days) ? ` · Days: ${d.available_days}` : '';
      return `• ${d.name}${qual}${spec}${days}`;
    });
    const childPol = /\b(child|children|kid|kids|paediatric|pediatric)\b/i.test(lower)
      ? kb.policies.find((p) => p.policy_type === 'children')
      : undefined;
    if (childPol) {
      doctorLines.push(`\n${childPol.title}: ${childPol.content}`);
    }
    const header =
      lang === 'hi'
        ? 'हमारे क्लिनिक के अनुमोदित डॉक्टर:\n'
        : lang === 'te'
          ? 'మా క్లినిక్‌లో అందుబాటులో ఉన్న వైద్యులు:\n'
          : 'Our clinic doctors:\n';
    return {
      matched: true,
      reply: header + doctorLines.join('\n'),
      sourceLabel: 'Answered from the clinic file',
      needsHuman: false,
      ticketCategory: 'Doctor enquiry',
    };
  }

  // Guard unconfirmed brand treatments not listed in services (e.g., Invisalign, veneers, zirconia)
  if (/\b(invisalign|veneer|veneers|zirconia|clear\s*correct)\b/i.test(lower)) {
    const mentionedInServices = kb.services.some((s) => lower.includes(s.name.toLowerCase()));
    if (!mentionedInServices) {
      return {
        matched: false,
        reply: '',
        sourceLabel: null,
        needsHuman: true,
        ticketCategory: 'Missing clinic information',
      };
    }
  }

  // 6. Consultation fees & treatment pricing
  const asksPricing =
    /\b(fee|fees|cost|price|prices|pricing|charges?|how\s+much|rate|rupees|rs|inr)\b/i.test(lower) ||
    /फीस|शुल्क|कितना\s*पैसा|खर्च|कीमत|चार्ज|दाम/.test(message) ||
    /ఫీజు|ధర|ఖర్చు|ఎంత|చార్జీ/.test(message) ||
    /fees entha|entha/i.test(lower);

  if (asksPricing) {
    // Explicitly check for unquoted procedures like crowns / veneers / dentures so we never guess
    if (/\b(crown|zirconia|veneer|denture|bridge)\b/i.test(lower)) {
      return {
        matched: false,
        reply: '',
        sourceLabel: null,
        needsHuman: true,
        ticketCategory: 'Pricing enquiry',
      };
    }

    const serviceKeywords: Array<{ pattern: RegExp; matchNames: string[] }> = [
      { pattern: /implant/i, matchNames: ['dental implant', 'dental implants'] },
      { pattern: /root\s*canal|rct/i, matchNames: ['root canal treatment'] },
      { pattern: /clean|scaling|polish/i, matchNames: ['teeth cleaning (scaling and polishing)', 'teeth cleaning'] },
      { pattern: /filling/i, matchNames: ['tooth filling'] },
      { pattern: /whiten|bleach/i, matchNames: ['teeth whitening'] },
      { pattern: /braces|aligner|orthodont/i, matchNames: ['braces (metal)', 'braces'] },
      { pattern: /x-?ray|xray/i, matchNames: ['x-ray (single)', 'x-ray'] },
      { pattern: /extract|removal/i, matchNames: ['tooth extraction'] },
      { pattern: /consult|checkup|check-up|opd/i, matchNames: ['consultation', 'dental consultation'] },
    ];

    const specific = serviceKeywords.find((s) => s.pattern.test(lower));
    if (specific) {
      const matchPrice = kb.pricing.find((p) =>
        specific.matchNames.includes(p.service_name.toLowerCase())
      );
      if (!matchPrice) {
        return {
          matched: false,
          reply: '',
          sourceLabel: null,
          needsHuman: true,
          ticketCategory: 'Pricing enquiry',
        };
      }
      const parts: string[] = [];
      if (isFilled(matchPrice.consultation_fee)) parts.push(`Consultation fee: ${matchPrice.consultation_fee}`);
      if (isFilled(matchPrice.treatment_price_range)) parts.push(`Price: ${matchPrice.treatment_price_range}`);
      if (isFilled(matchPrice.additional_charges)) parts.push(`Note: ${matchPrice.additional_charges}`);
      if (parts.length === 0) {
        return {
          matched: false,
          reply: '',
          sourceLabel: null,
          needsHuman: true,
          ticketCategory: 'Pricing enquiry',
        };
      }
      const prefix =
        lang === 'hi'
          ? `${matchPrice.service_name} के स्वीकृत शुल्क:\n`
          : lang === 'te'
            ? `${matchPrice.service_name} ఆమోదించిన ధరలు:\n`
            : `Approved pricing for ${matchPrice.service_name}:\n`;
      return {
        matched: true,
        reply: `${prefix}${parts.join(' · ')} (Last updated: ${matchPrice.last_updated.slice(0, 10)})`,
        sourceLabel: 'Answered from the clinic file',
        needsHuman: false,
        ticketCategory: 'Pricing enquiry',
      };
    }

    if (kb.pricing.length === 0) {
      return {
        matched: false,
        reply: '',
        sourceLabel: null,
        needsHuman: true,
        ticketCategory: 'Pricing enquiry',
      };
    }
    const lines = kb.pricing.map((p) => {
      const bits: string[] = [];
      if (isFilled(p.consultation_fee)) bits.push(`Consultation: ${p.consultation_fee}`);
      if (isFilled(p.treatment_price_range)) bits.push(`Price: ${p.treatment_price_range}`);
      if (isFilled(p.additional_charges)) bits.push(p.additional_charges);
      return `• ${p.service_name}: ${bits.join(' · ')}`;
    });
    const header =
      lang === 'hi'
        ? 'क्लिनिक की स्वीकृत शुल्क जानकारी:\n'
        : lang === 'te'
          ? 'క్లినిక్ ఆమోదించిన ఫీజుల వివరాలు:\n'
          : 'Approved clinic pricing:\n';
    return {
      matched: true,
      reply: header + lines.join('\n'),
      sourceLabel: 'Answered from the clinic file',
      needsHuman: false,
      ticketCategory: 'Pricing enquiry',
    };
  }

  // 7. Insurance information
  const asksInsurance =
    /\b(insurance|cashless|reimbursement|claim|tpa|mediclaim|star\s*health|niva\s*bupa)\b/i.test(lower) ||
    /बीमा|इंश्योरेंस|कैशलेस/.test(message) ||
    /బీమా|ఇన్సూరెన్స్|క్యాష్‌లెస్/.test(message);

  if (asksInsurance) {
    const insPolicy = kb.policies.find((p) => p.policy_type === 'insurance');
    if (kb.insurance.length === 0 && !insPolicy) {
      return {
        matched: false,
        reply: '',
        sourceLabel: null,
        needsHuman: true,
        ticketCategory: 'Insurance enquiry',
      };
    }
    const lines = kb.insurance.map((ins) => {
      const cashless = ins.cashless_available ? 'Cashless available' : 'Reimbursement only';
      const policy = isFilled(ins.reimbursement_policy) ? ` · ${ins.reimbursement_policy}` : '';
      return `• ${ins.provider_name} (${cashless})${policy}`;
    });
    if (insPolicy) {
      lines.push(`• Policy: ${insPolicy.content}`);
    }
    const header =
      lang === 'hi'
        ? 'स्वीकृत बीमा विवरण:\n'
        : lang === 'te'
          ? 'ఆమోదించబడిన బీమా వివరాలు:\n'
          : 'Approved insurance information:\n';
    return {
      matched: true,
      reply: header + lines.join('\n'),
      sourceLabel: 'Answered from the clinic file',
      needsHuman: false,
      ticketCategory: 'Insurance enquiry',
    };
  }

  // 8. Specific or general Clinic policies (EMI, walk-ins, children, sterilisation, first visit, cancellation, payment)
  const policyMatchers: Array<{ pattern: RegExp; types: string[] }> = [
    { pattern: /\b(emi|installment|monthly\s*payment)\b/i, types: ['emi'] },
    { pattern: /\b(walk-?in|without\s+appointment)\b/i, types: ['walk_ins'] },
    { pattern: /\b(child|children|kid|kids|paediatric|pediatric)\b/i, types: ['children'] },
    { pattern: /\b(first\s+visit|what\s+to\s+bring|bring)\b/i, types: ['first_visit'] },
    { pattern: /\b(sterilis|steriliz|autoclave|hygiene|cleanliness)\b/i, types: ['sterilisation'] },
    { pattern: /\b(cancel|cancellation|reschedule|late)\b/i, types: ['appointments', 'appointment_cancellation', 'rescheduling', 'late_arrival'] },
    { pattern: /\b(payment|upi|card|cash|pay)\b/i, types: ['payment', 'payment_methods'] },
  ];

  const matchedPolicyRule = policyMatchers.find((pm) => pm.pattern.test(lower));
  if (matchedPolicyRule) {
    const matchedPols = kb.policies.filter((p) => matchedPolicyRule.types.includes(p.policy_type));
    if (matchedPols.length > 0) {
      return {
        matched: true,
        reply: matchedPols.map((p) => `• ${p.title}: ${p.content}`).join('\n'),
        sourceLabel: 'Answered from the clinic file',
        needsHuman: false,
        ticketCategory: 'Other',
      };
    }
  }

  const asksPolicy =
    /\b(policy|policies|refund|follow-?up)\b/i.test(lower) ||
    /रद्द|रिफंड|भुगतान|पेमेंट|नियम/.test(message) ||
    /రద్దు|రిఫండ్|చెల్లింపు|నియమాలు/.test(message);

  if (asksPolicy) {
    if (kb.policies.length === 0) {
      return {
        matched: false,
        reply: '',
        sourceLabel: null,
        needsHuman: true,
        ticketCategory: 'Missing clinic information',
      };
    }
    const lines = kb.policies.map((pol) => `• ${pol.title}: ${pol.content}`);
    const header =
      lang === 'hi'
        ? 'क्लिनिक नीतियां:\n'
        : lang === 'te'
          ? 'క్లినిక్ విధానాలు:\n'
          : 'Clinic policies:\n';
    return {
      matched: true,
      reply: header + lines.join('\n'),
      sourceLabel: 'Answered from the clinic file',
      needsHuman: false,
      ticketCategory: 'Other',
    };
  }

  // 9. General services list
  const asksServices =
    /\b(services?|treatments?|what\s+do\s+you\s+do|procedures?|root\s*canal|implant|cleaning|whitening|braces|extraction|filling|x-?ray)\b/i.test(
      lower
    ) ||
    /सेवाएं|उपचार|इलाज/.test(message) ||
    /సేవలు|చికిత్స/.test(message);

  if (asksServices && kb.services.length > 0 && !/\b(crown|zirconia|veneer|denture|bridge)\b/i.test(lower)) {
    const names = kb.services.map((s) => s.name).join(', ');
    const reply =
      lang === 'hi'
        ? `क्लिनिक में उपलब्ध उपचार सेवाएं: ${names}।`
        : lang === 'te'
          ? `మా క్లినిక్‌లో అందుబాటులో ఉన్న చికిత్స సేవలు: ${names}.`
          : `Our clinic offers the following dental services: ${names}.`;
    return {
      matched: true,
      reply,
      sourceLabel: 'Answered from the clinic file',
      needsHuman: false,
      ticketCategory: 'Other',
    };
  }

  // No reliable match -> needs human
  return {
    matched: false,
    reply: '',
    sourceLabel: null,
    needsHuman: true,
    ticketCategory: 'Missing clinic information',
  };
}
