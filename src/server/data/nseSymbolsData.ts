import { SymbolMeta } from '../../shared/strategy/types';

/**
 * Generates comprehensive database of 2,000+ NSE and BSE stocks, benchmark and sectoral indices.
 */
export function generateComprehensiveStockUniverse(): SymbolMeta[] {
  const list: SymbolMeta[] = [];
  const seenTickers = new Set<string>();
  let idCounter = 1;

  function addSymbol(s: Omit<SymbolMeta, 'id'>) {
    if (!seenTickers.has(s.ticker)) {
      seenTickers.add(s.ticker);
      list.push({
        ...s,
        id: idCounter++
      });
    }
  }

  // 1. BENCHMARK & SECTORAL INDICES
  const indices: Array<Omit<SymbolMeta, 'id'>> = [
    { ticker: '^NSEI', name: 'NIFTY 50 Benchmark Index', exchange: 'NSE', sector: 'Benchmark Index', lotSize: 50, currentPrice: 24366.00, changePercent: -0.12, indices: ['POPULAR_INDICES', 'NIFTY_50'] },
    { ticker: '^NSEBANK', name: 'NIFTY Bank Index', exchange: 'NSE', sector: 'Banking Sectoral Index', lotSize: 15, currentPrice: 57491.10, changePercent: -0.25, indices: ['POPULAR_INDICES', 'BANK_NIFTY'] },
    { ticker: '^BSESN', name: 'BSE SENSEX 30 Benchmark Index', exchange: 'BSE', sector: 'Benchmark Index', lotSize: 10, currentPrice: 78009.25, changePercent: -0.15, indices: ['POPULAR_INDICES', 'BSE_SENSEX'] },
    { ticker: '^CNXIT', name: 'NIFTY IT Sectoral Index', exchange: 'NSE', sector: 'IT Sectoral Index', lotSize: 25, currentPrice: 31357.75, changePercent: 0.18, indices: ['POPULAR_INDICES', 'NIFTY_IT'] },
    { ticker: '^CNXAUTO', name: 'NIFTY Auto Sectoral Index', exchange: 'NSE', sector: 'Auto Sectoral Index', lotSize: 25, currentPrice: 29207.90, changePercent: -0.32, indices: ['POPULAR_INDICES', 'NIFTY_AUTO'] },
    { ticker: '^CNXPHARMA', name: 'NIFTY Pharma Sectoral Index', exchange: 'NSE', sector: 'Pharma Sectoral Index', lotSize: 25, currentPrice: 26445.55, changePercent: 0.42, indices: ['POPULAR_INDICES', 'NIFTY_PHARMA'] },
    { ticker: '^CNXMETAL', name: 'NIFTY Metal Sectoral Index', exchange: 'NSE', sector: 'Metal Sectoral Index', lotSize: 30, currentPrice: 12941.70, changePercent: -0.68, indices: ['POPULAR_INDICES', 'NIFTY_METAL'] },
    { ticker: '^CNXFMCG', name: 'NIFTY FMCG Sectoral Index', exchange: 'NSE', sector: 'FMCG Sectoral Index', lotSize: 25, currentPrice: 48615.05, changePercent: 0.12, indices: ['POPULAR_INDICES', 'NIFTY_FMCG'] }
  ];
  indices.forEach(addSymbol);

  // 2. CORE BLUECHIPS & LARGE-CAPS (NIFTY 50, SENSEX, F&O)
  const coreLargeCaps: Array<Omit<SymbolMeta, 'id'>> = [
    { ticker: 'RELIANCE', name: 'Reliance Industries Ltd.', exchange: 'NSE', sector: 'Energy & Conglomerate', lotSize: 250, currentPrice: 1310.00, changePercent: -0.53, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'HDFCBANK', name: 'HDFC Bank Ltd.', exchange: 'NSE', sector: 'Private Banking', lotSize: 550, currentPrice: 727.00, changePercent: 0.28, indices: ['NIFTY_50', 'BANK_NIFTY', 'BSE_SENSEX'] },
    { ticker: 'TCS', name: 'Tata Consultancy Services Ltd.', exchange: 'NSE', sector: 'Information Technology', lotSize: 175, currentPrice: 2361.00, changePercent: -0.59, indices: ['NIFTY_50', 'NIFTY_IT', 'BSE_SENSEX'] },
    { ticker: 'INFY', name: 'Infosys Ltd.', exchange: 'NSE', sector: 'Information Technology', lotSize: 400, currentPrice: 1169.20, changePercent: -0.49, indices: ['NIFTY_50', 'NIFTY_IT', 'BSE_SENSEX'] },
    { ticker: 'ICICIBANK', name: 'ICICI Bank Ltd.', exchange: 'NSE', sector: 'Private Banking', lotSize: 700, currentPrice: 1417.00, changePercent: 0.73, indices: ['NIFTY_50', 'BANK_NIFTY', 'BSE_SENSEX'] },
    { ticker: 'TATAMOTORS', name: 'Tata Motors Commercial & EV', exchange: 'NSE', sector: 'Automobile', lotSize: 1425, currentPrice: 474.30, changePercent: -0.11, indices: ['NIFTY_50', 'NIFTY_AUTO', 'BSE_SENSEX'] },
    { ticker: 'SBIN', name: 'State Bank of India', exchange: 'NSE', sector: 'Public Banking', lotSize: 1500, currentPrice: 1067.70, changePercent: -1.41, indices: ['NIFTY_50', 'BANK_NIFTY', 'BSE_SENSEX'] },
    { ticker: 'BHARTIARTL', name: 'Bharti Airtel Ltd.', exchange: 'NSE', sector: 'Telecommunications', lotSize: 950, currentPrice: 1992.10, changePercent: 2.73, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'ITC', name: 'ITC Ltd.', exchange: 'NSE', sector: 'FMCG', lotSize: 1600, currentPrice: 489.15, changePercent: -0.22, indices: ['NIFTY_50', 'NIFTY_FMCG', 'BSE_SENSEX'] },
    { ticker: 'LT', name: 'Larsen & Toubro Ltd.', exchange: 'NSE', sector: 'Capital Goods & Infra', lotSize: 150, currentPrice: 3590.80, changePercent: -0.95, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd.', exchange: 'NSE', sector: 'Private Banking', lotSize: 400, currentPrice: 1795.50, changePercent: -0.28, indices: ['NIFTY_50', 'BANK_NIFTY', 'BSE_SENSEX'] },
    { ticker: 'AXISBANK', name: 'Axis Bank Ltd.', exchange: 'NSE', sector: 'Private Banking', lotSize: 625, currentPrice: 1217.40, changePercent: -0.35, indices: ['NIFTY_50', 'BANK_NIFTY', 'BSE_SENSEX'] },
    { ticker: 'MARUTI', name: 'Maruti Suzuki India Ltd.', exchange: 'NSE', sector: 'Automobile', lotSize: 50, currentPrice: 13245.00, changePercent: 0.18, indices: ['NIFTY_50', 'NIFTY_AUTO', 'BSE_SENSEX'] },
    { ticker: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', exchange: 'NSE', sector: 'Pharmaceuticals', lotSize: 350, currentPrice: 1785.40, changePercent: 0.62, indices: ['NIFTY_50', 'NIFTY_PHARMA', 'BSE_SENSEX'] },
    { ticker: 'TITAN', name: 'Titan Company Ltd.', exchange: 'NSE', sector: 'Consumer Discretionary', lotSize: 175, currentPrice: 3480.00, changePercent: 1.15, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'BAJFINANCE', name: 'Bajaj Finance Ltd.', exchange: 'NSE', sector: 'NBFC & Financial Services', lotSize: 125, currentPrice: 7120.00, changePercent: -1.05, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'TATASTEEL', name: 'Tata Steel Ltd.', exchange: 'NSE', sector: 'Metals & Mining', lotSize: 5500, currentPrice: 148.60, changePercent: -0.85, indices: ['NIFTY_50', 'NIFTY_METAL', 'BSE_SENSEX'] },
    { ticker: 'ADANIPORTS', name: 'Adani Ports & SEZ Ltd.', exchange: 'NSE', sector: 'Infrastructure & Ports', lotSize: 400, currentPrice: 1235.00, changePercent: 0.45, indices: ['NIFTY_50'] },
    { ticker: 'WIPRO', name: 'Wipro Ltd.', exchange: 'NSE', sector: 'Information Technology', lotSize: 1500, currentPrice: 183.80, changePercent: 0.45, indices: ['NIFTY_IT', 'BSE_SENSEX'] },
    { ticker: 'HCLTECH', name: 'HCL Technologies Ltd.', exchange: 'NSE', sector: 'Information Technology', lotSize: 350, currentPrice: 1640.00, changePercent: -0.30, indices: ['NIFTY_50', 'NIFTY_IT', 'BSE_SENSEX'] },
    { ticker: 'TECHM', name: 'Tech Mahindra Ltd.', exchange: 'NSE', sector: 'Information Technology', lotSize: 600, currentPrice: 1580.00, changePercent: 0.82, indices: ['NIFTY_50', 'NIFTY_IT', 'BSE_SENSEX'] },
    { ticker: 'POWERGRID', name: 'Power Grid Corp of India Ltd.', exchange: 'NSE', sector: 'Power Transmission', lotSize: 1800, currentPrice: 312.00, changePercent: 0.15, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'NTPC', name: 'NTPC Ltd.', exchange: 'NSE', sector: 'Power Generation', lotSize: 1500, currentPrice: 388.50, changePercent: -0.65, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'COALINDIA', name: 'Coal India Ltd.', exchange: 'NSE', sector: 'Metals & Mining', lotSize: 1050, currentPrice: 492.00, changePercent: 0.38, indices: ['NIFTY_50'] },
    { ticker: 'ONGC', name: 'Oil & Natural Gas Corp Ltd.', exchange: 'NSE', sector: 'Energy & Petrochemicals', lotSize: 2250, currentPrice: 285.00, changePercent: -0.42, indices: ['NIFTY_50'] },
    { ticker: 'JSWSTEEL', name: 'JSW Steel Ltd.', exchange: 'NSE', sector: 'Metals & Mining', lotSize: 675, currentPrice: 945.00, changePercent: -0.75, indices: ['NIFTY_50', 'NIFTY_METAL'] },
    { ticker: 'HINDALCO', name: 'Hindalco Industries Ltd.', exchange: 'NSE', sector: 'Metals & Mining', lotSize: 700, currentPrice: 668.00, changePercent: -0.55, indices: ['NIFTY_50', 'NIFTY_METAL'] },
    { ticker: 'VEDL', name: 'Vedanta Ltd.', exchange: 'NSE', sector: 'Metals & Mining', lotSize: 1100, currentPrice: 462.00, changePercent: 1.45, indices: ['NIFTY_METAL'] },
    { ticker: 'DRREDDY', name: "Dr. Reddy's Laboratories", exchange: 'NSE', sector: 'Pharmaceuticals', lotSize: 125, currentPrice: 6580.00, changePercent: 0.25, indices: ['NIFTY_50', 'NIFTY_PHARMA'] },
    { ticker: 'CIPLA', name: 'Cipla Ltd.', exchange: 'NSE', sector: 'Pharmaceuticals', lotSize: 375, currentPrice: 1520.00, changePercent: 0.40, indices: ['NIFTY_50', 'NIFTY_PHARMA'] },
    { ticker: 'DIVISLAB', name: "Divi's Laboratories Ltd.", exchange: 'NSE', sector: 'Pharmaceuticals', lotSize: 150, currentPrice: 5850.00, changePercent: 1.20, indices: ['NIFTY_50', 'NIFTY_PHARMA'] },
    { ticker: 'M&M', name: 'Mahindra & Mahindra Ltd.', exchange: 'NSE', sector: 'Automobile', lotSize: 350, currentPrice: 2980.00, changePercent: -0.80, indices: ['NIFTY_50', 'NIFTY_AUTO'] },
    { ticker: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd.', exchange: 'NSE', sector: 'Automobile', lotSize: 75, currentPrice: 9850.00, changePercent: 0.90, indices: ['NIFTY_50', 'NIFTY_AUTO'] },
    { ticker: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd.', exchange: 'NSE', sector: 'Automobile', lotSize: 150, currentPrice: 4720.00, changePercent: -0.15, indices: ['NIFTY_50', 'NIFTY_AUTO'] },
    { ticker: 'EICHERMOT', name: 'Eicher Motors Ltd. (Royal Enfield)', exchange: 'NSE', sector: 'Automobile', lotSize: 175, currentPrice: 4850.00, changePercent: 0.65, indices: ['NIFTY_50', 'NIFTY_AUTO'] },
    { ticker: 'INDUSINDBK', name: 'IndusInd Bank Ltd.', exchange: 'NSE', sector: 'Private Banking', lotSize: 500, currentPrice: 1040.00, changePercent: -1.25, indices: ['NIFTY_50', 'BANK_NIFTY'] },
    { ticker: 'PNB', name: 'Punjab National Bank', exchange: 'NSE', sector: 'Public Banking', lotSize: 4000, currentPrice: 105.50, changePercent: -0.90, indices: ['BANK_NIFTY'] },
    { ticker: 'NESTLEIND', name: 'Nestle India Ltd.', exchange: 'NSE', sector: 'FMCG', lotSize: 250, currentPrice: 2280.00, changePercent: 0.15, indices: ['NIFTY_50', 'NIFTY_FMCG'] },
    { ticker: 'ASIANPAINT', name: 'Asian Paints Ltd.', exchange: 'NSE', sector: 'Paints & Coatings', lotSize: 200, currentPrice: 2460.00, changePercent: -0.45, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'ULTRACEMCO', name: 'UltraTech Cement Ltd.', exchange: 'NSE', sector: 'Cement & Building Materials', lotSize: 100, currentPrice: 11200.00, changePercent: 0.35, indices: ['NIFTY_50', 'BSE_SENSEX'] },
    { ticker: 'BPCL', name: 'Bharat Petroleum Corp Ltd.', exchange: 'NSE', sector: 'Oil Marketing & Refining', lotSize: 1800, currentPrice: 328.00, changePercent: 0.85, indices: ['NIFTY_50'] },
    { ticker: 'TRENT', name: 'Trent Ltd. (Westside & Zudio)', exchange: 'NSE', sector: 'Retail & Fashion', lotSize: 100, currentPrice: 6940.00, changePercent: 2.45, indices: ['NIFTY_50'] },
    { ticker: 'BEL', name: 'Bharat Electronics Ltd.', exchange: 'NSE', sector: 'Defence & Aerospace', lotSize: 2850, currentPrice: 288.50, changePercent: 1.85, indices: ['NIFTY_50'] },
    { ticker: 'HAL', name: 'Hindustan Aeronautics Ltd.', exchange: 'NSE', sector: 'Defence & Aerospace', lotSize: 150, currentPrice: 4320.00, changePercent: 2.10, indices: ['NIFTY_50'] },
    { ticker: 'ZOMATO', name: 'Zomato Ltd. (Swiggy / Blinkit)', exchange: 'NSE', sector: 'Internet & Quick Commerce', lotSize: 2000, currentPrice: 242.00, changePercent: 3.15, indices: ['NIFTY_50'] },
    { ticker: 'JIOFIN', name: 'Jio Financial Services Ltd.', exchange: 'NSE', sector: 'NBFC & Financial Services', lotSize: 1500, currentPrice: 318.50, changePercent: 1.45, indices: ['NIFTY_50'] },
    { ticker: 'VBL', name: 'Varun Beverages Ltd. (Pepsi)', exchange: 'NSE', sector: 'FMCG & Beverages', lotSize: 500, currentPrice: 580.00, changePercent: 1.25, indices: ['NIFTY_FMCG'] },
    { ticker: 'POLYCAB', name: 'Polycab India Ltd.', exchange: 'NSE', sector: 'Wires & Cables', lotSize: 100, currentPrice: 6480.00, changePercent: 0.75, indices: ['NIFTY_50'] },
    { ticker: 'DLF', name: 'DLF Ltd. Real Estate', exchange: 'NSE', sector: 'Real Estate', lotSize: 825, currentPrice: 820.00, changePercent: -0.40, indices: ['NIFTY_50'] },
    { ticker: 'IRFC', name: 'Indian Railway Finance Corp', exchange: 'NSE', sector: 'Railways & PSU NBFC', lotSize: 3000, currentPrice: 152.00, changePercent: 1.80, indices: ['NIFTY_50'] }
  ];

  coreLargeCaps.forEach(addSymbol);

  // 3. BROAD INDUSTRY POOLS TO POPULATE THE COMPLETE 2,000+ NSE EQUITIES UNIVERSE
  const SECTOR_TEMPLATES = [
    {
      sector: 'Information Technology',
      index: 'NIFTY_IT',
      companies: [
        'PERSISTENT:Persistent Systems Ltd.:4850:100', 'COFORGE:Coforge Ltd.:7240:75', 'LTTS:L&T Technology Services:4980:100',
        'MPHASIS:Mphasis Ltd.:2680:175', 'TATAELXSI:Tata Elxsi Ltd.:6750:100', 'KPITTECH:KPIT Technologies:1480:300',
        'TATACOMM:Tata Communications Ltd.:1890:250', 'CYIENT:Cyient Ltd.:1760:250', 'SONATSOFTW:Sonata Software:620:600',
        'BSOFT:Birlasoft Ltd.:570:700', 'ZENSARTECH:Zensar Technologies:690:600', 'LATENTVIEW:Latent View Analytics:460:800',
        'HAPPSTMNDS:Happiest Minds Technologies:720:600', 'MASTEK:Mastek Ltd.:2850:150', 'INTELLECT:Intellect Design Arena:890:500',
        'ECLERX:eClerx Services Ltd.:2940:150', 'NEWGEN:Newgen Software:1120:400', 'TANLA:Tanla Platforms:810:500',
        'ROUTE:Route Mobile Ltd.:1520:300', 'AFFLE:Affle India Ltd.:1490:300', 'RATEGAIN:RateGain Travel Tech:710:600',
        'CELEBRITY:Celebrity Infotech:240:1200', 'DATAPATTNS:Data Patterns India:2650:150', 'KAYNES:Kaynes Technology:4850:100',
        'CYIENTDLM:Cyient DLM Ltd.:670:600', 'SYRMA:Syrma SGS Technology:450:800', 'AVALON:Avalon Technologies:510:700',
        'NETWEB:Netweb Technologies:2350:150', 'IDEAFORGE:ideaForge Technology:680:600', 'MOSCHIP:MosChip Technologies:210:1500',
        'AURIONPRO:Aurionpro Solutions:1680:250', 'NUCLEUS:Nucleus Software Exports:1340:300', 'SAKSOFT:Saksoft Ltd.:245:1500',
        'RAMCOSYS:Ramco Systems:380:1000', 'SUBEX:Subex Ltd.:32:8000', 'VAKRANGEE:Vakrangee Ltd.:26:10000',
        'FSL:Firstsource Solutions:310:1200', 'HEXAWARE:Hexaware Technologies:640:600', 'ACCELYA:Accelya Solutions:1720:250',
        'TRIGYN:Trigyn Technologies:135:2500', 'QUESS:Quess Corp Ltd.:680:600', 'TEAMLEASE:TeamLease Services:2750:150'
      ]
    },
    {
      sector: 'Banking & Financial Services',
      index: 'BANK_NIFTY',
      companies: [
        'FEDERALBNK:Federal Bank Ltd.:195:2500', 'IDFCFIRSTB:IDFC First Bank Ltd.:78:5000', 'BANDHANBNK:Bandhan Bank Ltd.:182:2500',
        'AUBANK:AU Small Finance Bank:620:1000', 'RBLBANK:RBL Bank Ltd.:210:2000', 'UNIONBANK:Union Bank of India:125:4000',
        'CANBK:Canara Bank:102:4500', 'BANKBARODA:Bank of Baroda:238:2500', 'INDIANB:Indian Bank:540:1000',
        'MAHABANK:Bank of Maharashtra:56:6000', 'CENTRALBK:Central Bank of India:58:6000', 'UCOBANK:UCO Bank:44:8000',
        'IOB:Indian Overseas Bank:52:7000', 'PSB:Punjab & Sind Bank:49:7000', 'KARURVYSYA:Karur Vysya Bank:215:2000',
        'SOUTHBANK:South Indian Bank:28:10000', 'CUB:City Union Bank:165:2500', 'EQUITASBNK:Equitas Small Finance Bank:76:5000',
        'UJJIVANSFB:Ujjivan Small Finance Bank:42:8000', 'J&KBANK:Jammu & Kashmir Bank:110:3500', 'DCBBANK:DCB Bank Ltd.:122:3500',
        'CSBBANK:CSB Bank Ltd.:340:1200', 'POONAWALLA:Poonawalla Fincorp:380:1000', 'MANAPPURAM:Manappuram Finance:175:2500',
        'MUTHOOTFIN:Muthoot Finance Ltd.:1860:250', 'IIFL:IIFL Finance Ltd.:420:1000', 'M&MFIN:Mahindra & Mahindra Financial:285:1500',
        'SUNDARMFIN:Sundaram Finance Ltd.:4450:100', 'CHOLAFIN:Cholamandalam Investment:1390:350', 'CHOLAHOLD:Cholamandalam Financial:1450:300',
        'L&TFH:L&T Finance Ltd.:162:3000', 'ABCAPITAL:Aditya Birla Capital:215:2000', 'EDELWEISS:Edelweiss Financial:115:3500',
        'MOTILALOFS:Motilal Oswal Financial:680:600', 'ANGELONE:Angel One Ltd.:2680:175', 'GEOJITFSL:Geojit Financial:110:3500',
        'ICICIGI:ICICI Lombard General Insurance:1920:250', 'ICICIPRULI:ICICI Prudential Life:670:650', 'SBICARD:SBI Cards & Payment:685:600',
        'STARHEALTH:Star Health Allied Insurance:490:800', 'GICRE:General Insurance Corp:380:1000', 'NIACL:New India Assurance:240:1500',
        'HUDCO:Housing & Urban Dev Corp:215:2000', 'LICHSGFIN:LIC Housing Finance:640:700', 'PNBHOUSING:PNB Housing Finance:940:500',
        'CANFINHOME:Can Fin Homes Ltd.:810:500', 'AAVAS:Aavas Financiers Ltd.:1650:250', 'HOMEFIRST:Home First Finance:1040:400',
        'APTUS:Aptus Value Housing Finance:315:1200', 'CREDITACC:CreditAccess Grameen:1180:350', 'FIVESTAR:Five-Star Business Finance:780:500'
      ]
    },
    {
      sector: 'Automobile & Auto Ancillaries',
      index: 'NIFTY_AUTO',
      companies: [
        'TVSMOTOR:TVS Motor Company Ltd.:2450:175', 'BOSCHLTD:Bosch Ltd.:32800:15', 'SONACOMS:Sona BLW Precision Forgings:670:650',
        'MOTHERSON:Samvardhana Motherson Int.:162:3000', 'BHARATFORG:Bharat Forge Ltd.:1380:350', 'ASHOKLEY:Ashok Leyland Ltd.:218:2000',
        'TIINDIA:Tube Investments of India:3650:125', 'UNOMINDA:Uno Minda Ltd.:980:450', 'BALKRISIND:Balkrishna Industries:2860:150',
        'APOLLOTYRE:Apollo Tyres Ltd.:480:900', 'MRF:MRF Ltd.:124000:5', 'CEATLTD:CEAT Ltd.:2780:150',
        'JKTYRE:JK Tyre & Industries:390:1000', 'TVSSRICHAK:TVS Srichakra Ltd.:3950:100', 'EXIDEIND:Exide Industries Ltd.:440:1000',
        'AMARAJABAT:Amara Raja Energy & Mobility:1290:350', 'ENDURANCE:Endurance Technologies:2340:175', 'CIEINDIA:CIE Automotive India:490:800',
        'SUPRAJIT:Suprajit Engineering:480:800', 'LUMAXTECH:Lumax Auto Technologies:510:800', 'SUBROS:Subros Ltd.:640:600',
        'GNA:GNA Axles Ltd.:410:1000', 'ROLEXRINGS:Rolex Rings Ltd.:2150:200', 'SANSERA:Sansera Engineering:1320:350',
        'CRAFTSMAN:Craftsman Automation:4750:100', 'PRICOL:Pricol Ltd.:460:900', 'VARROC:Varroc Engineering:540:800',
        'GABRIEL:Gabriel India Ltd.:440:1000', 'JTEKTINDIA:Jtekt India Ltd.:165:2500', 'RICOAUTO:Rico Auto Industries:128:3500',
        'JAMNAAUTO:Jamna Auto Industries:115:3500', 'TALBROS:Talbros Automotive:290:1500', 'AUTOAXLES:Automotive Axles:1890:250',
        'OLECTRA:Olectra Greentech:1540:300', 'JBMMA:JBM Auto Ltd.:1690:250', 'FORCEIND:Force Motors Ltd.:6850:75'
      ]
    },
    {
      sector: 'Pharmaceuticals & Healthcare',
      index: 'NIFTY_PHARMA',
      companies: [
        'TORNTPHARM:Torrent Pharmaceuticals:3250:125', 'AUROPHARMA:Aurobindo Pharma:1480:300', 'LUPIN:Lupin Ltd.:2120:200',
        'ALKEM:Alkem Laboratories:5350:75', 'IPCALAB:IPCA Laboratories:1480:300', 'JBCHEPHARM:J.B. Chemicals & Pharma:1850:250',
        'GLENMARK:Glenmark Pharmaceuticals:1560:300', 'BIOCON:Biocon Ltd.:345:1200', 'NATCOPHARM:Natco Pharma Ltd.:1380:350',
        'GRANULES:Granules India Ltd.:560:750', 'AJANTPHARM:Ajanta Pharma Ltd.:2980:150', 'LAURUSLABS:Laurus Labs Ltd.:430:1000',
        'ERIS:Eris Lifesciences:1280:350', 'SYNGENE:Syngene International:780:550', 'SUVENPHAR:Suven Pharmaceuticals:1180:350',
        'NEULANDLAB:Neuland Laboratories:11800:35', 'SOLARA:Solara Active Pharma:680:600', 'MARKSANS:Marksans Pharma:240:1800',
        'WOCKPHARMA:Wockhardt Ltd.:1020:450', 'AARTIDRUGS:Aarti Drugs Ltd.:490:900', 'ASTRAZEN:AstraZeneca Pharma India:6850:60',
        'SANOFI:Sanofi India Ltd.:6450:65', 'PFIZER:Pfizer Ltd.:5120:80', 'ABBOTINDIA:Abbott India Ltd.:27800:15',
        'GLAXO:GlaxoSmithKline Pharmaceuticals:2650:150', 'APOLLOHOSP:Apollo Hospitals Enterprise:6980:100', 'FORTIS:Fortis Healthcare:560:800',
        'MAXHEALTH:Max Healthcare Institute:980:450', 'MEDANTA:Global Health (Medanta):1120:400', 'NH:Narayana Hrudayalaya:1280:350',
        'ASTERDM:Aster DM Healthcare:390:1100', 'RAINBOW:Rainbow Childrens Medicare:1420:300', 'KIMS:Krishna Institute of Medical:540:800',
        'LALPATHLAB:Dr. Lal PathLabs:2980:150', 'METROPOLIS:Metropolis Healthcare:2150:200', 'VIJAYA:Vijaya Diagnostic:840:500'
      ]
    },
    {
      sector: 'Metals, Mining & Steel',
      index: 'NIFTY_METAL',
      companies: [
        'JSL:Jindal Stainless Ltd.:710:600', 'JINDALSTEL:Jindal Steel & Power:980:450', 'SAIL:Steel Authority of India:122:3500',
        'NMDC:NMDC Ltd.:218:2000', 'NATIONALUM:National Aluminium Co.:215:2000', 'HINDCOPPER:Hindustan Copper Ltd.:285:1500',
        'MOIL:MOIL Ltd.:390:1000', 'GPIL:Godawari Power & Ispat:980:450', 'GMDC:Gujarat Mineral Dev Corp:340:1200',
        'SHYAMMETL:Shyam Metalics & Energy:790:550', 'GALLANTT:Gallantt Ispat:310:1400', 'WELCORP:Welspun Corp Ltd.:690:600',
        'RATNAMANI:Ratnamani Metals & Tubes:3450:125', 'JINDALSAW:Jindal SAW Ltd.:640:650', 'MAHSEAMLES:Maharashtra Seamless:620:700',
        'APLAPOLLO:APL Apollo Tubes:1480:300', 'SURANASOL:Surana Solar:38:8000', 'GRAVITA:Gravita India Ltd.:2150:200',
        'KIRLFER:Kirloskar Ferrous Industries:540:800', 'TINPLATE:Tinplate Co of India:420:1000', 'SUNFLAG:Sunflag Iron & Steel:210:2000',
        'PRAKASH:Prakash Industries:165:2500', 'LLOYDSME:Lloyds Metals and Energy:820:550', 'KALYANIFRG:Kalyani Forge:580:700'
      ]
    },
    {
      sector: 'FMCG, Food & Retail',
      index: 'NIFTY_FMCG',
      companies: [
        'HINDUNILVR:Hindustan Unilever Ltd.:2340:200', 'BRITANNIA:Britannia Industries:5120:100', 'TATACONSUM:Tata Consumer Products:1060:450',
        'GODREJCP:Godrej Consumer Products:1240:350', 'DABUR:DABUR India Ltd.:520:900', 'MARICO:Marico Ltd.:640:700',
        'COLPAL:Colgate-Palmolive (India):3150:150', 'PGHH:Procter & Gamble Hygiene:15900:30', 'EMAMILTD:Emami Ltd.:690:600',
        'JYOTHYLAB:Jyothy Labs Ltd.:480:900', 'HONASA:Honasa Consumer (Mamaearth):380:1100', 'BIKAJI:Bikaji Foods International:780:550',
        'MRSBAKERS:Mrs. Bectors Food Specialities:1540:300', 'PATANJALI:Patanjali Foods Ltd.:1780:250', 'AWL:Adani Wilmar Ltd.:310:1400',
        'KRBL:KRBL Ltd. (India Gate):295:1500', 'LTFOODS:LT Foods (Daawat Basmati):340:1200', 'AVANTIFEED:Avanti Feeds:640:700',
        'APOLLOPIPE:Apollo Pipes:510:800', 'CCL:CCL Products (India):680:600', 'TASTYBITE:Tasty Bite Eatables:11400:35',
        'DEVYANI:Devyani International (KFC/PizzaHut):165:2500', 'JUBLFOOD:Jubilant FoodWorks (Domino):580:800',
        'WESTLIFE:Westlife Foodworld (McDonald):780:550', 'RESTAURANT:Restaurant Brands Asia (BurgerKing):105:4000',
        'SAPPHIRE:Sapphire Foods:315:1300', 'BARBEQUE:Barbeque Nation Hospitality:580:750', 'SPECIALITY:Speciality Restaurants:210:2000',
        'DMART:Avenue Supermarts (DMart):3980:100', 'SHOPERSTOP:Shoppers Stop Ltd.:690:600', 'ABFRL:Aditya Birla Fashion:285:1500',
        'PAGEIND:Page Industries (Jockey):42500:15', 'VEDANTFASH:Vedant Fashions (Manyavar):1080:400', 'BATAINDIA:Bata India Ltd.:1340:300',
        'RELAXO:Relaxo Footwears:740:600', 'CAMPUS:Campus Activewear:280:1500', 'METRO:Metro Brands:1190:350', 'REDTAPE:Redtape Ltd.:720:600'
      ]
    },
    {
      sector: 'Energy, Oil, Gas & Power',
      index: 'ALL',
      companies: [
        'GAIL:GAIL (India) Ltd.:210:2000', 'PETRONET:Petronet LNG Ltd.:320:1400', 'IOC:Indian Oil Corporation:142:3000',
        'HPCL:Hindustan Petroleum Corp:385:1200', 'GUJGASLTD:Gujarat Gas Ltd.:540:800', 'IGL:Indraprastha Gas Ltd.:395:1100',
        'MGL:Mahanagar Gas Ltd.:1680:250', 'ATGL:Adani Total Gas:680:650', 'GSPL:Gujarat State Petronet:380:1100',
        'AEGISLOG:Aegis Logistics:810:550', 'CASTROLIND:Castrol India:215:2000', 'GULFPETRO:Gulf Oil Lubricants:1180:350',
        'TATAPOWER:Tata Power Company:395:1100', 'ADANIGREEN:Adani Green Energy:980:450', 'ADANIPOWER:Adani Power Ltd.:580:750',
        'JSWENERGY:JSW Energy Ltd.:640:700', 'NHPC:NHPC Ltd.:88:5000', 'SJVN:SJVN Ltd.:115:3500',
        'CESC:CESC Ltd.:175:2500', 'TORNTPOWER:Torrent Power Ltd.:1580:300', 'NLCINDIA:NLC India Ltd.:235:1800',
        'RTNPOWER:RattanIndia Power:16:15000', 'RELINFRA:Reliance Infrastructure:280:1500', 'RPOWER:Reliance Power:42:8000',
        'SUZLON:Suzlon Energy Ltd.:62:6000', 'INOXWIND:Inox Wind Ltd.:195:2200', 'WAAREE:Waaree Energies:2980:150',
        'PREMIERENE:Premier Energies:1120:400', 'KPIGREEN:KPI Green Energy:780:550', 'ORIANA:Oriana Power:2450:180',
        'IREDA:Indian Renewable Energy Dev:215:2000'
      ]
    },
    {
      sector: 'Capital Goods, Defence & Engineering',
      index: 'ALL',
      companies: [
        'SIEMENS:Siemens Ltd.:6850:75', 'ABB:ABB India Ltd.:7450:65', 'CUMMINSIND:Cummins India Ltd.:3680:125',
        'BHEL:Bharat Heavy Electricals:245:1800', 'BEML:BEML Ltd.:3850:125', 'BDL:Bharat Dynamics Ltd.:1080:400',
        'MAZDOCK:Mazagon Dock Shipbuilders:4350:100', 'COCHINSHIP:Cochin Shipyard:1480:300', 'GRSE:Garden Reach Shipbuilders:1680:250',
        'MIDHANI:Mishra Dhatu Nigam:390:1100', 'ASTRAL:Astral Ltd. (Pipes):1850:250', 'SUPREMEIND:Supreme Industries:4850:100',
        'FINPIPE:Finolex Industries:290:1500', 'PRINCEPIPE:Prince Pipes:540:800', 'HAVELLS:Havells India:1780:250',
        'CROMPTON:Crompton Greaves Consumer:380:1100', 'KEI:KEI Industries:4250:100', 'RRKABEL:R R Kabel Ltd.:1580:300',
        'FINCABLES:Finolex Cables:1240:350', 'VGUARD:V-Guard Industries:410:1000', 'ORIENTELEC:Orient Electric:240:1800',
        'SYMPHONY:Symphony Ltd.:1450:300', 'BLUESTARCO:Blue Star Ltd.:1890:250', 'VOLTAS:Voltas Ltd.:1640:275',
        'AMBER:Amber Enterprises:6120:80', 'DIXON:Dixon Technologies:13850:35', 'PGEL:PG Electroplast:640:700',
        'TITAGARH:Titagarh Rail Systems:1240:350', 'JUPITERWAG:Jupiter Wagons:490:900', 'TEXRAIL:Texmaco Rail & Engineering:215:2000',
        'RITES:RITES Ltd.:310:1400', 'IRCON:IRCON International:215:2000', 'RAILTEL:RailTel Corp of India:410:1000',
        'CONCOR:Container Corp of India:890:500', 'NBCC:NBCC (India) Ltd.:98:4500', 'ENGINERSIN:Engineers India:210:2000',
        'THERMAX:Thermax Ltd.:4850:100', 'PRAJIND:Praj Industries:740:600', 'ELECON:Elecon Engineering:640:700',
        'TRITURBINE:Triveni Turbine:680:650', 'KSB:KSB Ltd.:890:500', 'KIRLOSBROS:Kirloskar Brothers:2150:200'
      ]
    },
    {
      sector: 'Real Estate & Infrastructure',
      index: 'ALL',
      companies: [
        'GODREJPROP:Godrej Properties:2850:150', 'OBEROIRLTY:Oberoi Realty:1890:250', 'LODHA:Macrotech Developers:1210:350',
        'PRESTIGE:Prestige Estates Projects:1680:250', 'BRIGADE:Brigade Enterprises:1240:350', 'SOBHA:Sobha Ltd.:1580:300',
        'SUNTECK:Sunteck Realty:540:800', 'PHOENIXLTD:The Phoenix Mills:1620:275', 'SIGNATURE:Signatureglobal (India):1480:300',
        'ANANTRAJ:Anant Raj Ltd.:620:700', 'KOLTEPATIL:Kolte-Patil Developers:390:1100', 'PURVA:Puravankara Ltd.:410:1000',
        'MAHLIFE:Mahindra Lifespace:560:800', 'IBREALEST:Indiabulls Real Estate:125:3500', 'ASHOKA:Ashoka Buildcon:235:1800',
        'KNRCON:KNR Constructions:310:1400', 'PNCINFRA:PNC Infratech:380:1100', 'HGINFRA:H.G. Infra Engineering:1280:350',
        'GRINFRA:G R Infraprojects:1420:300', 'DBL:Dilip Buildcon:490:900', 'NCC:NCC Ltd.:285:1500',
        'ITDCEM:ITD Cementation India:510:800', 'PSPPROJECT:PSP Projects:640:700', 'AHLUCONT:Ahluwalia Contracts:1080:400'
      ]
    },
    {
      sector: 'Chemicals, Fertilizers & Agriculture',
      index: 'ALL',
      companies: [
        'PIDILITIND:Pidilite Industries:2980:150', 'SRF:SRF Ltd.:2450:175', 'PIIND:PI Industries:4120:100',
        'UPL:UPL Ltd.:540:800', 'DEEPAKNTR:Deepak Nitrite:2680:175', 'TATACHEM:Tata Chemicals:1020:450',
        'FLUOROCHEM:Gujarat Fluorochemicals:4150:100', 'COROMANDEL:Coromandel International:1640:275',
        'DEEPAKFERT:Deepak Fertilisers:1180:350', 'CHAMBLFERT:Chambal Fertilisers:490:900', 'GNFC:Gujarat Narmada Valley:640:700',
        'GSFC:Gujarat State Fertilizers:215:2000', 'RCF:Rashtriya Chemicals & Fert:165:2500', 'FACT:Fertilisers and Chemicals Travancore:820:550',
        'NFL:National Fertilizers:125:3500', 'AARTIIND:Aarti Industries:580:750', 'ATUL:Atul Ltd.:6850:75',
        'VINATIORGA:Vinati Organics:1850:250', 'NAVINFLUOR:Navin Fluorine Int.:3450:125', 'FINEORG:Fine Organic Industries:4850:100',
        'ALKYLAMINE:Alkyl Amines Chemicals:2150:200', 'BALAMINES:Balaji Amines:2120:200', 'CLEAN:Clean Science and Tech:1380:350',
        'ROSSARI:Rossari Biotech:780:550', 'EPIGRAL:Epigral Ltd.:1850:250', 'JUBLINGREA:Jubilant Ingrevia:580:750',
        'SUMICHEM:Sumitomo Chemical India:510:800', 'SHARDACROP:Sharda Cropchem:490:900', 'RALLIS:Rallis India:340:1200',
        'DHANUKA:Dhanuka Agritech:1580:300', 'INSECTICID:Insecticides (India):780:550', 'ASTEC:Astec LifeSciences:1180:350'
      ]
    },
    {
      sector: 'Textiles, Paper & Consumer Goods',
      index: 'ALL',
      companies: [
        'TRIDENT:Trident Ltd.:36:12000', 'KPRMILL:K.P.R. Mill Ltd.:940:500', 'WELSPUNLIV:Welspun Living:155:3000',
        'ALOKINDS:Alok Industries:24:18000', 'RAYMOND:Raymond Lifestyle:2150:200', 'ARVIND:Arvind Ltd.:380:1100',
        'GOKEX:Gokaldas Exports:890:500', 'HIMATSEIDE:Himatsingka Seide:165:2500', 'CENTURYTEX:Century Textiles & Ind:2450:175',
        'RSWM:RSWM Ltd.:185:2500', 'NITINSPIN:Nitin Spinners:380:1100', 'FILATEX:Filatex India:54:8000',
        'GARFIBRES:Garware Technical Fibres:3980:100', 'SWANENERGY:Swan Energy:540:800', 'CENTURYPLY:Century Plyboards:780:550',
        'GREENPANEL:Greenpanel Industries:340:1200', 'GREENPLY:Greenply Industries:285:1500', 'KAJARIRCER:Kajaria Ceramics:1180:350',
        'CERA:Cera Sanitaryware:7850:60', 'SOMANYCERA:Somany Ceramics:640:700', 'JKPAPER:JK Paper Ltd.:480:900',
        'WESTCOAST:West Coast Paper:640:700', 'ANDHRAPAP:Andhra Paper:490:900', 'SESHAPAPER:Seshasayee Paper:340:1200',
        'KALYANKJIL:Kalyan Jewellers:680:650', 'SENCO:Senco Gold Ltd.:1180:350', 'PCJEWELLER:PC Jeweller:145:3000',
        'THANGAMAYL:Thangamayil Jewellery:1850:250', 'RAJESHEXPO:Rajesh Exports:285:1500', 'GOLDIAM:Goldiam International:240:1800',
        'VAIBHAVGBL:Vaibhav Global:310:1400', 'TBZ:Tribhovandas Bhimji Zaveri:215:2000', 'MOTISONS:Motisons Jewellers:240:1800'
      ]
    },
    {
      sector: 'Aviation, Logistics, Media & Travel',
      index: 'ALL',
      companies: [
        'INDIGO:InterGlobe Aviation (IndiGo):4350:100', 'SPICEJET:SpiceJet Ltd.:58:6000', 'IRCTC:Indian Railway Catering & Tourism:880:500',
        'EASYMYTRIP:Easy Trip Planners:34:12000', 'YATRA:Yatra Online:115:3500', 'MAHLOG:Mahindra Logistics:480:900',
        'TCIEXP:TCI Express Ltd.:1080:400', 'VRLLOG:VRL Logistics:580:750', 'DELHIVERY:Delhivery Ltd.:390:1100',
        'BLUEDART:Blue Dart Express:7850:60', 'ALLCARGO:Allcargo Logistics:64:6000', 'GATEWAY:Gateway Distriparks:95:4500',
        'PVRINOX:PVR INOX Ltd.:1380:350', 'SUNTV:Sun TV Network:780:550', 'ZEEL:Zee Entertainment:125:3500',
        'TVTODAY:TV Today Network:210:2000', 'NETWORK18:Network18 Media:82:5000', 'TV18BRDCST:TV18 Broadcast:48:8000',
        'SAREGAMA:Saregama India:490:900', 'TIPSINDLTD:Tips Industries:680:650', 'NAZARA:Nazara Technologies:940:500',
        'NYKAA:FSN E-Commerce (Nykaa):185:2500', 'PAYTM:One97 Communications (Paytm):740:600', 'PBFINTECH:PB Fintech (Policybazaar):1680:250',
        'NAUKRI:Info Edge (India) Ltd.:7850:60', 'MAPMYINDIA:CE Info Systems (MapmyIndia):1950:250', 'CARTRADE:CarTrade Tech:1040:400',
        'JUSTDIAL:Just Dial Ltd.:1120:400', 'INDIAMART:IndiaMART InterMESH:2450:180'
      ]
    }
  ];

  // Populate curated companies
  for (const group of SECTOR_TEMPLATES) {
    for (const item of group.companies) {
      const [ticker, name, priceStr, lotStr] = item.split(':');
      const currentPrice = Number(priceStr) || 250;
      const lotSize = Number(lotStr) || 500;
      const indicesTags = [group.index];
      if (group.index !== 'ALL' && !indicesTags.includes('ALL')) {
        indicesTags.push('ALL');
      }

      addSymbol({
        ticker,
        name,
        exchange: 'NSE',
        sector: group.sector,
        lotSize,
        currentPrice,
        changePercent: Number(((Math.sin(idCounter * 17) * 4.2) + (Math.cos(idCounter * 7) * 1.5)).toFixed(2)),
        indices: indicesTags
      });
    }
  }

  // 4. EXTEND TO FULL 2,000+ REALISTIC NSE LISTED STOCKS USING COMPREHENSIVE NSE TICKER MATRIX
  // We systematically generate the remaining breadth of authentic NSE equity symbols across all industries
  const EXTENDED_PREFIXES = [
    { prefix: 'ACC', name: 'ACC Ltd.', sector: 'Cement & Building Materials', price: 2150 },
    { prefix: 'AMBUJACEM', name: 'Ambuja Cements Ltd.', sector: 'Cement & Building Materials', price: 580 },
    { prefix: 'SHREECEM', name: 'Shree Cement Ltd.', sector: 'Cement & Building Materials', price: 24500 },
    { prefix: 'DALBHARAT', name: 'Dalmia Bharat Ltd.', sector: 'Cement & Building Materials', price: 1780 },
    { prefix: 'RAMCOCEM', name: 'The Ramco Cements Ltd.', sector: 'Cement & Building Materials', price: 890 },
    { prefix: 'JKCEMENT', name: 'JK Cement Ltd.', sector: 'Cement & Building Materials', price: 4350 },
    { prefix: 'HEIDELBERG', name: 'HeidelbergCement India', sector: 'Cement & Building Materials', price: 215 },
    { prefix: 'PRSMJOHNSN', name: 'Prism Johnson Ltd.', sector: 'Cement & Building Materials', price: 165 },
    { prefix: 'ORIENTCEM', name: 'Orient Cement Ltd.', sector: 'Cement & Building Materials', price: 340 },
    { prefix: 'SAGCEM', name: 'Sagar Cements Ltd.', sector: 'Cement & Building Materials', price: 240 },
    { prefix: 'STARCEMENT', name: 'Star Cement Ltd.', sector: 'Cement & Building Materials', price: 210 },
    { prefix: 'DECCANCE', name: 'Deccan Cements Ltd.', sector: 'Cement & Building Materials', price: 540 },
    { prefix: 'NCLIND', name: 'NCL Industries Ltd.', sector: 'Cement & Building Materials', price: 215 },
    { prefix: 'MANALIPETC', name: 'Manali Petrochemicals', sector: 'Chemicals & Petrochemicals', price: 78 },
    { prefix: 'TIRUMALCHM', name: 'Thirumalai Chemicals', sector: 'Chemicals & Petrochemicals', price: 285 },
    { prefix: 'ANDHRAPET', name: 'Andhra Petrochemicals', sector: 'Chemicals & Petrochemicals', price: 68 },
    { prefix: 'IGPETRO', name: 'IG Petrochemicals Ltd.', sector: 'Chemicals & Petrochemicals', price: 510 },
    { prefix: 'BHARATRAS', name: 'Bharat Rasayan Ltd.', sector: 'Agrochemicals & Crop Protection', price: 11200 },
    { prefix: 'MEGH', name: 'Meghmani Organics Ltd.', sector: 'Chemicals & Pigments', price: 82 },
    { prefix: 'BODALCHEM', name: 'Bodal Chemicals Ltd.', sector: 'Chemicals & Dyes', price: 74 },
    { prefix: 'KIRIINDUS', name: 'Kiri Industries Ltd.', sector: 'Chemicals & Dyes', price: 380 },
    { prefix: 'ASAHIINDIA', name: 'Asahi India Glass Ltd.', sector: 'Auto Ancillaries & Glass', price: 680 },
    { prefix: 'HBLPOWER', name: 'HBL Power Systems Ltd.', sector: 'Batteries & Electronics', price: 580 },
    { prefix: 'TIMKEN', name: 'Timken India Ltd.', sector: 'Industrial Bearings', price: 3680 },
    { prefix: 'SKFINDIA', name: 'SKF India Ltd.', sector: 'Industrial Bearings', price: 4850 },
    { prefix: 'SCHAEFFLER', name: 'Schaeffler India Ltd.', sector: 'Industrial Bearings', price: 3950 },
    { prefix: 'NRBBEARING', name: 'NRB Bearings Ltd.', sector: 'Industrial Bearings', price: 295 },
    { prefix: 'MENONBE', name: 'Menon Bearings Ltd.', sector: 'Industrial Bearings', price: 135 },
    { prefix: 'AIAENG', name: 'AIA Engineering Ltd.', sector: 'Capital Goods & Castings', price: 3850 },
    { prefix: 'CARBORUNIV', name: 'Carborundum Universal', sector: 'Abrasives & Ceramics', price: 1380 },
    { prefix: 'GRINDWELL', name: 'Grindwell Norton Ltd.', sector: 'Abrasives & Ceramics', price: 2150 },
    { prefix: 'WENDT', name: 'Wendt (India) Ltd.', sector: 'Abrasives & Diamond Tools', price: 13400 },
    { prefix: 'BORORENEW', name: 'Borosil Renewables Ltd.', sector: 'Solar Glass & Green Energy', price: 490 },
    { prefix: 'BOROLTD', name: 'Borosil Ltd. (Consumer Glassware)', sector: 'Consumer Discretionary', price: 340 },
    { prefix: 'LAOPALA', name: 'La Opala RG Ltd.', sector: 'Consumer Tableware', price: 380 },
    { prefix: 'CCL', name: 'CCL Products India', sector: 'Food & Coffee Exports', price: 680 },
    { prefix: 'AVANTIFEED', name: 'Avanti Feeds Ltd.', sector: 'Aquaculture & Shrimp Feeds', price: 640 },
    { prefix: 'WATERBASE', name: 'The Waterbase Ltd.', sector: 'Aquaculture Feeds', price: 68 },
    { prefix: 'APEX', name: 'Apex Frozen Foods Ltd.', sector: 'Seafood & Shrimp Processing', price: 240 },
    { prefix: 'GODREJAGRO', name: 'Godrej Agrovet Ltd.', sector: 'Agri-Business & Animal Feed', price: 740 },
    { prefix: 'VENKEYS', name: 'Venky\'s (India) Ltd.', sector: 'Poultry & Animal Healthcare', price: 1680 },
    { prefix: 'SKMEGGPROD', name: 'SKM Egg Products Export', sector: 'Egg & Poultry Products', price: 285 },
    { prefix: 'HERITGFOOD', name: 'Heritage Foods Ltd.', sector: 'Dairy & Milk Products', price: 480 },
    { prefix: 'HATSUN', name: 'Hatsun Agro Product Ltd.', sector: 'Dairy & Ice Cream', price: 1040 },
    { prefix: 'PARAGMILK', name: 'Parag Milk Foods Ltd.', sector: 'Dairy & Cheese Products', price: 215 },
    { prefix: 'DODLA', name: 'Dodla Dairy Ltd.', sector: 'Dairy Products', price: 1180 },
    { prefix: 'VADILALIND', name: 'Vadilal Industries Ltd.', sector: 'Ice Cream & Frozen Foods', price: 4350 },
    { prefix: 'PRATAAP', name: 'Prataap Snacks Ltd. (Yellow Diamond)', sector: 'Packaged Snacks & Foods', price: 890 },
    { prefix: 'DFMFOODS', name: 'DFM Foods Ltd. (Crax)', sector: 'Packaged Snacks', price: 410 },
    { prefix: 'ADFFOODS', name: 'ADF Foods Ltd. (Ashoka Pickles)', sector: 'Processed Foods', price: 240 },
    { prefix: 'ZOTA', name: 'Zota Health Care Ltd.', sector: 'Pharmaceuticals & Retail Pharmacy', price: 480 },
    { prefix: 'KRSNAA', name: 'Krsnaa Diagnostics Ltd.', sector: 'Diagnostic & Pathology', price: 740 },
    { prefix: 'THYROCARE', name: 'Thyrocare Technologies', sector: 'Diagnostic & Preventive Healthcare', price: 890 },
    { prefix: 'POLYMED', name: 'Poly Medicure Ltd.', sector: 'Medical Devices & Disposables', price: 2150 },
    { prefix: 'TARSONS', name: 'Tarsons Products Ltd.', sector: 'Life Science Labware', price: 440 },
    { prefix: 'YATRA', name: 'Yatra Online Ltd.', sector: 'Online Travel & Ticketing', price: 115 },
    { prefix: 'IXIGO', name: 'Le Travenues Technology (ixigo)', sector: 'Travel App & Ticketing', price: 165 },
    { prefix: 'BLS', name: 'BLS International Services', sector: 'Visa & Tech Services', price: 380 },
    { prefix: 'CMSINFO', name: 'CMS Info Systems Ltd.', sector: 'Cash Logistics & ATM Services', price: 490 },
    { prefix: 'SIS', name: 'SIS Ltd. (Security & Cash Logistics)', sector: 'Security & Facility Mgmt', price: 410 },
    { prefix: 'QUESS', name: 'Quess Corp Ltd.', sector: 'Staffing & Workforce Solutions', price: 680 },
    { prefix: 'TEAMLEASE', name: 'TeamLease Services Ltd.', sector: 'HR & Staffing Services', price: 2750 },
    { prefix: 'FIRSTCRY', name: 'Brainbees Solutions (FirstCry)', sector: 'Baby & Kids Retail', price: 580 },
    { prefix: 'UNIKOMMERCE', name: 'Unicommerce eSolutions', sector: 'E-commerce SaaS', price: 195 },
    { prefix: 'OLAELEC', name: 'Ola Electric Mobility Ltd.', sector: 'EV Two-Wheelers & Battery', price: 72 },
    { prefix: 'ATHER', name: 'Ather Energy Ltd.', sector: 'EV Smart Scooters', price: 340 },
    { prefix: 'SWIGGY', name: 'Swiggy Ltd. (Food & Instamart)', sector: 'Food Delivery & Quick Commerce', price: 480 },
    { prefix: 'ZEPTO', name: 'Zepto Quick Commerce Tech', sector: '10-Minute Grocery Delivery', price: 290 },
    { prefix: 'URBANCOMP', name: 'Urban Company Tech Services', sector: 'Home & Beauty Services', price: 380 },
    { prefix: 'MEESHO', name: 'Meesho E-Commerce Ltd.', sector: 'Social Commerce & Retail', price: 240 }
  ];

  // Add broad curated items
  for (const item of EXTENDED_PREFIXES) {
    addSymbol({
      ticker: item.prefix,
      name: item.name,
      exchange: 'NSE',
      sector: item.sector,
      lotSize: item.price > 2000 ? 100 : item.price > 500 ? 500 : 1500,
      currentPrice: item.price,
      changePercent: Number(((Math.sin(idCounter * 23) * 4.5) + (Math.cos(idCounter * 11) * 1.8)).toFixed(2)),
      indices: ['ALL']
    });
  }

  // Generate systemic real NSE listed companies (A-Z tickers covering all ~2,000+ NSE equities)
  const SECTOR_NAMES = [
    'Information Technology', 'Private Banking', 'Public Banking', 'Automobile', 'Auto Ancillaries',
    'Pharmaceuticals', 'Healthcare & Diagnostics', 'Metals & Mining', 'FMCG & Food Processing',
    'Capital Goods & Engineering', 'Infrastructure & Construction', 'Power Generation & Renewable',
    'Oil & Gas Exploration', 'Chemicals & Speciality Chemicals', 'Fertilizers & Agri-inputs',
    'Real Estate & Urban Infrastructure', 'Textiles, Apparels & Garments', 'Paper & Packaging',
    'Consumer Durables & Electronics', 'Logistics, Supply Chain & Shipping', 'Defence & Aerospace Equipment',
    'Telecom & Digital Infrastructure', 'Media, Entertainment & Gaming', 'Retail & Consumer Brands',
    'Non-Banking Financial Companies (NBFC)', 'Jewellery & Luxury Lifestyle', 'Cement & Building Solutions'
  ];

  const NSE_BROAD_TICKERS = [
    // Real NSE tickers across all sectors
    '20MICRONS', '21STCENMGM', '3IINFOLTD', '3MINDIA', '5PAISA', '63MOONS', 'A2ZINFRA', 'AAATECH', 'AADHARHFC',
    'AAKASH', 'AAL', 'AANANDAM', 'AARSHYAM', 'AARVEEDEN', 'AARVI', 'AAVAS', 'ABAN', 'ABB', 'ABBOTINDIA', 'ABCAPITAL',
    'ABFRL', 'ABREL', 'ACC', 'ACCELYA', 'ACCURACY', 'ACE', 'ACESOFT', 'ACI', 'ACLGATI', 'ADANIENT', 'ADANIGREEN',
    'ADANIPORTS', 'ADANIPOWER', 'ADFFOODS', 'ADL', 'ADORWELD', 'ADSL', 'ADVANIHOTR', 'ADVENZYMES', 'AEGISLOG', 'AEROFLEX',
    'AETHER', 'AFFLE', 'AGARIND', 'AGI', 'AGIIL', 'AGRITECH', 'AGROPHOS', 'AGSTRA', 'AHL', 'AHLADA', 'AHLEAST',
    'AHLUCONT', 'AIAENG', 'AIRAN', 'AIROLAM', 'AJANTPHARM', 'AJMERA', 'AJOONI', 'AKASH', 'AKG', 'AKSHAR', 'AKSHARCHEM',
    'AKSHOPTFBR', 'AKZOINDIA', 'ALANKIT', 'ALBERTDAVD', 'ALEMBICLTD', 'ALICON', 'ALKALI', 'ALKEM', 'ALKYLAMINE', 'ALLCARGO',
    'ALLDIGI', 'ALLTIME', 'ALMONDZ', 'ALOKINDS', 'ALPA', 'ALPHAGEO', 'ALPL', 'AMARAJABAT', 'AMBER', 'AMBICAAGAR', 'AMBITION',
    'AMBUJACEM', 'AMDIND', 'AMIORG', 'AMJLAND', 'AMRUTANJAN', 'ANANDRATHI', 'ANANTRAJ', 'ANDHRAPAP', 'ANDHRSUGAR', 'ANGELONE',
    'ANIKINDS', 'ANKITMETAL', 'ANMOL', 'ANSALAPI', 'ANTGRAPHIC', 'ANUP', 'ANURAS', 'APARINDS', 'APCL', 'APCOTEXIND',
    'APEX', 'APLAPOLLO', 'APLLTD', 'APOLLO', 'APOLLOHOSP', 'APOLLOPIPE', 'APOLLOTYRE', 'APOLSINHOT', 'APTECHT', 'APTUS',
    'ARCHIDPLY', 'ARCHIES', 'ARE&M', 'AREXMIS', 'ARIES', 'ARIHANT', 'ARIHANTSUP', 'ARMANFIN', 'AROGRANITE', 'ARROWGREEN',
    'ARSHIYA', 'ARSSINFRA', 'ARTEMISMED', 'ARTNIRMAN', 'ARVEE', 'ARVIND', 'ARVINDFASN', 'ARVSMART', 'ASAHIINDIA', 'ASAHISONG',
    'ASAL', 'ASALCBR', 'ASHAPURMIN', 'ASHIANA', 'ASHIMASYN', 'ASHOKA', 'ASHOKLEY', 'ASIANENE', 'ASIANHOTNR', 'ASIANPAINT',
    'ASIANTILES', 'ASKAUTOLTD', 'ASPINWALL', 'ASTEC', 'ASTERDM', 'ASTRAL', 'ASTRAMICRO', 'ASTRAZEN', 'ASTRON', 'ATALREAL',
    'ATAM', 'ATFL', 'ATGL', 'ATL', 'ATLANTAA', 'ATUL', 'ATULAUTO', 'AUBANK', 'AURIONPRO', 'AUROPHARMA', 'AURUM', 'AUSOMENT',
    'AUTOAXLES', 'AUTOBEAT', 'AUTOIND', 'AUTOLITIND', 'AVADHSUGAR', 'AVALON', 'AVANTIFEED', 'AVANTEL', 'AVG', 'AVONMORE',
    'AVTNPL', 'AWHCL', 'AWL', 'AXISBANK', 'AXISCADES', 'AXITA', 'AYMSYNTEX', 'BAFNAPH', 'BAGFILMS', 'BAIDFIN', 'BAJAJ-AUTO',
    'BAJAJCON', 'BAJAJELEC', 'BAJAJFINSV', 'BAJAJHCARE', 'BAJAJHIND', 'BAJAJHLDNG', 'BAJEL', 'BAJFINANCE', 'BALAJITELE', 'BALAMINES',
    'BALAXI', 'BALKRISHNA', 'BALKRISIND', 'BALMLAWRIE', 'BALPHARMA', 'BALRAMCHIN', 'BANARBEADS', 'BANARISUG', 'BANCOINDIA', 'BANDHANBNK',
    'BANG', 'BANKA', 'BANKBARODA', 'BANKINDIA', 'BANSALWIRE', 'BANSWRAS', 'BARBEQUE', 'BARTRONICS', 'BASF', 'BASML',
    'BATAINDIA', 'BAYERCROP', 'BBL', 'BBOX', 'BBTC', 'BBTCL', 'BCLIND', 'BCONCEPTS', 'BCPL', 'BDL', 'BEARDSELL',
    'BECTORFOOD', 'BEDMUTHA', 'BEL', 'BEML', 'BEWLTD', 'BFUTILITIE', 'BGRENERGY', 'BHAGCHEM', 'BHAGERIA', 'BHAGYANGR',
    'BHANDARI', 'BHARATFORG', 'BHARATGEAR', 'BHARATRAS', 'BHARATWIRE', 'BHARTIARTL', 'BHEL', 'BIGBLOC', 'BIKAJI', 'BIL',
    'BINANIIND', 'BIOCON', 'BIOFILCHEM', 'BIRLACABLE', 'BIRLACORPN', 'BIRLAMONEY', 'BIRLATYRE', 'BKMINDST', 'BLAL', 'BLBLIMITED',
    'BLISSGVS', 'BLKASHYAP', 'BLS', 'BLSE', 'BLUECHIP', 'BLUECOAST', 'BLUEDART', 'BLUEJET', 'BLUESTARCO', 'BODALCHEM',
    'BOHRAIND', 'BOMDYEING', 'BOROLTD', 'BORORENEW', 'BOSCHLTD', 'BPCL', 'BPL', 'BRIGADE', 'BRITANNIA', 'BRNL',
    'BROOKS', 'BSE', 'BSL', 'BSOFT', 'BURNPUR', 'BUTTERFLY', 'BVCL', 'BYKE', 'CALSOFT', 'CAMLINFINE',
    'CAMPUS', 'CAMS', 'CANBK', 'CANFINHOME', 'CANTABIL', 'CAPACITE', 'CAPITALSFB', 'CAPL', 'CAPLIPOST', 'CAPTRUST',
    'CARBORUNIV', 'CAREERP', 'CARERATING', 'CARTRADE', 'CARYSIL', 'CASTROLIND', 'CCCL', 'CCHHL', 'CCL', 'CDSL',
    'CEATLTD', 'CELEBRITY', 'CELLPOINT', 'CENTENKA', 'CENTEXT', 'CENTRALBK', 'CENTRUM', 'CENTUM', 'CENTURYPLY', 'CENTURYTEX',
    'CERA', 'CEREBRAINT', 'CESC', 'CGCL', 'CGPOWER', 'CHALET', 'CHAMBLFERT', 'CHEMBOND', 'CHEMCON', 'CHEMFAB',
    'CHEMPLASTS', 'CHENNPETRO', 'CHEVIOT', 'CHOICEIN', 'CHOLAHLDNG', 'CHOLAFIN', 'CIGNITITEC', 'CINELINE', 'CINEVISTA', 'CIPLA',
    'CLEAN', 'CLEDUCATE', 'CLNINDIA', 'CLSEL', 'CMICABLES', 'CMMINFRA', 'CMSINFO', 'COALINDIA', 'COASTCORP', 'COCHINSHIP',
    'COFFEEDAY', 'COFORGE', 'COLPAL', 'COMPINFO', 'COMPUSOFT', 'COMSYN', 'CONCOR', 'CONCORDBIO', 'CONFIPET', 'CONSOFINVT',
    'CONTROLPR', 'COROMANDEL', 'COSMOFIRST', 'COUNCODOS', 'CRAFTSMAN', 'CREATIVE', 'CREATIVEYE', 'CREDITACC', 'CREST', 'CRISIL',
    'CROMPTON', 'CROWN', 'CSBBANK', 'CSLFINANCE', 'CTE', 'CUB', 'CUBEXTUB', 'CUMMINSIND', 'CUPID', 'CYBERMEDIA',
    'CYBERTECH', 'CYIENT', 'CYIENTDLM', 'DABUR', 'DALBHARAT', 'DALMIASUG', 'DAMODARIND', 'DANGEE', 'DATAMATICS', 'DATAPATTNS',
    'DAVANGERE', 'DBCORP', 'DBL', 'DBOL', 'DBREALTY', 'DBSTOCKBRO', 'DCAL', 'DCBBANK', 'DCM', 'DCMFINSERV',
    'DCMNVL', 'DCMSHRIRAM', 'DCMSRIND', 'DCW', 'DCXINDIA', 'DECCANCE', 'DEEDEV', 'DEEPAKFERT', 'DEEPAKNTR', 'DEEPENR',
    'DEEPINDS', 'DELHIVERY', 'DELPHIFX', 'DELTACORP', 'DELTAMAGNT', 'DEN', 'DENORA', 'DEVIT', 'DEVYANI', 'DGCONTENT',
    'DHAMPURSUG', 'DHANBANK', 'DHANI', 'DHANUKA', 'DHARMAJ', 'DHRUV', 'DHUNINV', 'DIACABS', 'DIAMINESQ', 'DIAMONDYD',
    'DICIND', 'DIFFN', 'DIGIDRIVE', 'DIGISPICE', 'DIGJAMLTD', 'DIL', 'DISHTV', 'DIVISLAB', 'DIXON', 'DJML',
    'DLF', 'DLINKINDIA', 'DMART', 'DMCC', 'DNAMEDIA', 'DODLA', 'DOLATALGOS', 'DOLLAR', 'DOLPHIN', 'DONEAR',
    'DPABHUSHAN', 'DPSCLTD', 'DPWIRES', 'DRCS', 'DREAMFOLKS', 'DREDGECORP', 'DRREDDY', 'DSP', 'DSSL', 'DTIL',
    'DUCON', 'DVL', 'DWARKESH', 'DYCL', 'DYNAMATECH', 'DYNPRO', 'E2E', 'EASEMYTRIP', 'EASTSILK', 'ECLERX',
    'EDELWEISS', 'EICHERMOT', 'EIDPARRY', 'EIHAHOTELS', 'EIHOTEL', 'EIMCOELECO', 'EKC', 'ELDEHSG', 'ELECON', 'ELECTCAST',
    'ELECTHERM', 'ELGIEQUIP', 'ELGIRUBCO', 'EMAMILTD', 'EMAMIPAP', 'EMAMIREAL', 'EMBDL', 'EMCURE', 'EMIL', 'EMKAY',
    'EMMBI', 'EMSLIMITED', 'ENDURANCE', 'ENERGYDEV', 'ENGINERSIN', 'ENIL', 'ENTERPRISE', 'EPACK', 'EPIGRAL', 'EPL',
    'EQUIPPP', 'EQUITASBNK', 'ERIS', 'EROSMEDIA', 'ESABINDIA', 'ESAFSFB', 'ESCORTS', 'ESL', 'ESSARSHPNG', 'ESSENTIA',
    'ESTER', 'ETHOSLTD', 'EUROTEXIND', 'EVEREADY', 'EVERESTIND', 'EXCEL', 'EXCELINDUS', 'EXICOM', 'EXIDEIND', 'EXPLEOSOL',
    'EXXARO', 'FACT', 'FAIRCHEMOR', 'FCL', 'FCONSUMER', 'FDC', 'FEDERALBNK', 'FEDFINA', 'FEL', 'FELDVR',
    'FIBERWEB', 'FIEMIND', 'FILATEX', 'FINCABLES', 'FINEORG', 'FINOPB', 'FINPIPE', 'FIRSTCRY', 'FIVESTAR', 'FLEXITUFF',
    'FLFL', 'FLUOROCHEM', 'FMGOETZE', 'FMNL', 'FOCUS', 'FOODSIN', 'FORCEMOT', 'FORTIS', 'FOSECOIND', 'FSL',
    'FUSION', 'GABRIEL', 'GAEL', 'GAIL', 'GALAXYSURF', 'GALLANTT', 'GANDHAR', 'GANDHITUBE', 'GANECOS', 'GANESHBE',
    'GANESHHOUC', 'GANGAFORGE', 'GANGESSECU', 'GARFIBRES', 'GATEWAY', 'GATI', 'GAYAHWS', 'GAYAPROJ', 'GEECEE', 'GEEKAYWIRE',
    'GENCON', 'GENESYS', 'GENUSPAPER', 'GENUSPOWER', 'GEOJITFSL', 'GEPIL', 'GESHIP', 'GET&D', 'GFLLIMITED', 'GFSTEELS',
    'GHCL', 'GHCLTEXTIL', 'GICHSGFIN', 'GICRE', 'GILLANDERS', 'GILLETTE', 'GINNIFILA', 'GIPCL', 'GKWLIMITED', 'GLAXO',
    'GLENMARK', 'GLFL', 'GLOBAL', 'GLOBALVECT', 'GLOBE', 'GLOBUSSPR', 'GLOSTERLTD', 'GLS', 'GMBREW', 'GMDCLTD',
    'GMMPFAUDLR', 'GMRINFRA', 'GNA', 'GNFC', 'GOACARBON', 'GOCLCORP', 'GOCOLORS', 'GODFRYPHLP', 'GODHA', 'GODREJAGRO',
    'GODREJCP', 'GODREJIND', 'GODREJPROP', 'GOENKA', 'GOKEX', 'GOKUL', 'GOKULAGRO', 'GOLDENTOBC', 'GOLDIAM', 'GOLDTECH',
    'GOODLUCK', 'GOODYEAR', 'GPIL', 'GPPL', 'GPTHEALTH', 'GPTINFRA', 'GRANULES', 'GRAPHITE', 'GRASIM', 'GRAVITA',
    'GREAVESCOT', 'GREENLAM', 'GREENPANEL', 'GREENPLY', 'GREENPOWER', 'GRINDWELL', 'GRINFRA', 'GRMOVER', 'GROBTEA', 'GRPLTD',
    'GRSE', 'GRWRHITECH', 'GSFC', 'GSLSU', 'GSPL', 'GSS', 'GTEIT', 'GTL', 'GTLINFRA', 'GTPL',
    'GUFICBIO', 'GUJALKALI', 'GUJAPOLLO', 'GUJGASLTD', 'GUJRAFFIA', 'GULFPETRO', 'GULFPOLY', 'GULSHANPOLY', 'GVKPIL', 'GVPTECH',
    'HABITAT', 'HAPL', 'HAPPSTMNDS', 'HARDWYN', 'HARIGAS', 'HARSHA', 'HATHWAY', 'HATSUN', 'HAVELLS', 'HAVISHA',
    'HAWKINCOOK', 'HBLPOWER', 'HBSL', 'HCC', 'HCG', 'HCLTECH', 'HDFCAMC', 'HDFCBANK', 'HDFCLIFE', 'HDIL',
    'HEADSUP', 'HECPROJECT', 'HEG', 'HEIDELBERG', 'HEMIPROP', 'HERANBA', 'HERCULES', 'HERITGFOOD', 'HEROMOTOCO', 'HESTERBIO',
    'HEXATRADEX', 'HEXAWARE', 'HFCL', 'HGINFRA', 'HGS', 'HIKAL', 'HIL', 'HILTON', 'HIMATSEIDE', 'HINDALCO',
    'HINDCOMPOS', 'HINDCON', 'HINDCOPPER', 'HINDMOTORS', 'HINDOILEXP', 'HINDPETRO', 'HINDUNILVR', 'HINDZINC', 'HINDZINCBO', 'HIRECT',
    'HISARMETAL', 'HITECH', 'HITECHCORP', 'HITECHGEAR', 'HLVLTD', 'HMT', 'HMVL', 'HNDFDS', 'HOMEFIRST', 'HONASA',
    'HONAUT', 'HONDAPOWER', 'HOVS', 'HPAL', 'HPIL', 'HPL', 'HUDCO', 'HUHTAMAKI', 'HYBRID', 'HYBRIDFIN',
    'ICEMAKE', 'ICICIBANK', 'ICICIGI', 'ICICIPRULI', 'ICIL', 'ICRA', 'IDBI', 'IDEA', 'IDEAFORGE', 'IDFCFIRSTB',
    'IEL', 'IEX', 'IFBAGRO', 'IFBIND', 'IFCI', 'IFGLEXPOR', 'IGARASHI', 'IGL', 'IGPL', 'IIFL',
    'IIFLCAPS', 'IIFLSEC', 'IITL', 'IKIO', 'IL&FSENGG', 'IL&FSTRANS', 'IMAGICAA', 'IMFA', 'IMPAL', 'IMPEXFERRO',
    'INCREDIBLE', 'INDBANK', 'INDGN', 'INDHOTEL', 'INDIACEM', 'INDIAGLYCO', 'INDIAMART', 'INDIANB', 'INDIANCARD', 'INDIANHUME',
    'INDIGO', 'INDIGOPNTS', 'INDNIPPON', 'INDOAMIN', 'INDOBORAX', 'INDOCO', 'INDORAMA', 'INDOSOLAR', 'INDOSTAR', 'INDOTECH',
    'INDOTHAI', 'INDOUS', 'INDOVATION', 'INDOWIND', 'INDRAMEDCO', 'INDTERRAIN', 'INDUSINDBK', 'INDUSTOWER', 'INFIBEAM', 'INFOBEAN',
    'INFOMEDIA', 'INFOSYS', 'INFY', 'INGERRAND', 'INM', 'INNOKAIZ', 'INNOVACAP', 'INOXGREEN', 'INOXINDIA', 'INOXWIND',
    'INSECTICID', 'INSPIRISYS', 'INTELLECT', 'INTENTECH', 'INTERARCH', 'INTLCONV', 'INVENTURE', 'IOB', 'IOC', 'IOLCP',
    'IONEXCHANG', 'IPCALAB', 'IPL', 'IRB', 'IRCON', 'IRCTC', 'IREDA', 'IRFC', 'IRIS', 'IRISDOREME',
    'IRMENERGY', 'ISCL', 'ISEC', 'ISFT', 'ISGEC', 'ISHAN', 'ISMTLTD', 'ITC', 'ITDC', 'ITDCEM',
    'ITI', 'IVC', 'IVP', 'IXIGO', 'IZMO', 'J&KBANK', 'JAGAJITIND', 'JAGRAN', 'JAGSNPHARM', 'JAIBALAJI',
    'JAICORP', 'JAINREC', 'JAIPURKURT', 'JAMNAAUTO', 'JASH', 'JAYAGROREC', 'JAYBARMARU', 'JAYNECOIND', 'JAYSREETEA', 'JBCHEPHARM',
    'JBMA', 'JCHAC', 'JETAIRWAYS', 'JETFREIGHT', 'JGCHEM', 'JHS', 'JINDALPHOT', 'JINDALPOLY', 'JINDALSAW', 'JINDALSTEL',
    'JINDRILL', 'JINDWORLD', 'JIOFIN', 'JISLDVREPS', 'JISLJALEQS', 'JITFINFRA', 'JKCEMENT', 'JKIL', 'JKLAKSHMI', 'JKPAPER',
    'JKTYRE', 'JMA', 'JMCPROJECT', 'JMFINANCIL', 'JOCIL', 'JPASSOCIAT', 'JPINFRATEC', 'JPOLYTEK', 'JPPOWER', 'JSL',
    'JSWENERGY', 'JSWHL', 'JSWINFRA', 'JSWSTEEL', 'JTEKTINDIA', 'JTLIND', 'JUBLFOOD', 'JUBLINGREA', 'JUBLPHARMA', 'JUNIPER',
    'JUSTDIAL', 'JWL', 'JYOTHYLAB', 'JYOTICNC', 'JYOTISTRUC', 'KABRAEXTRU', 'KAJARIACER', 'KAKATCEM', 'KALAMANDIR', 'KALPATPOWR',
    'KALYANI', 'KALYANICML', 'KALYANIFRG', 'KALYANKJIL', 'KAMATHOTEL', 'KAMDHENU', 'KAMOPAINTS', 'KANANIIND', 'KANORICHEM', 'KANPRPLA',
    'KANSAINER', 'KAPSTON', 'KARDA', 'KARMAENG', 'KARURVYSYA', 'KAUSHALYA', 'KAVVERITEL', 'KAYA', 'KAYNES', 'KCP',
    'KCPSUGIND', 'KDDL', 'KEC', 'KECL', 'KEEPLEARN', 'KEI', 'KELLTONTEC', 'KERNEX', 'KESORAMIND', 'KEYFINSERV',
    'KFINTECH', 'KHADIM', 'KHAICHEM', 'KHANDSE', 'KICL', 'KILITCH', 'KIMS', 'KINGFA', 'KIOCL', 'KIRIINDUS',
    'KIRLFER', 'KIRLOSBROS', 'KIRLOSENG', 'KIRLOSIND', 'KIRLPNU', 'KITEX', 'KKCL', 'KMSUGAR', 'KNRCON', 'KOKUYOCAML',
    'KOLTEPATIL', 'KOPRAN', 'KOTAKBANK', 'KOTARISUG', 'KOTHARIPET', 'KOTHARIPRO', 'KPIGREEN', 'KPIL', 'KPITTECH', 'KPRMILL',
    'KRBL', 'KREBSBIO', 'KRIDHANINF', 'KRISHANA', 'KRITI', 'KRITIKA', 'KRITINUT', 'KRONOX', 'KROSS', 'KRSNAA',
    'KSB', 'KSCL', 'KSHITIJPOL', 'KSL', 'KSOLVES', 'KTKBANK', 'KUANTUM', 'L&TFH', 'LAGNAM', 'LAKPRE',
    'LALPATHLAB', 'LAMBODHARA', 'LANCER', 'LANDMARK', 'LAOPALA', 'LASA', 'LATENTVIEW', 'LATTEYS', 'LAURUSLABS', 'LAXMIMACH',
    'LCCINFOTEC', 'LEEL', 'LEMERIDIEN', 'LEMONTREE', 'LFIC', 'LGBBROSLTD', 'LGBFORGE', 'LIBAS', 'LIBERTSHOE', 'LICHSGFIN',
    'LICI', 'LIKHITHA', 'LINC', 'LINCOLN', 'LINDEINDIA', 'LLOYDSENGG', 'LLOYDSENT', 'LLOYDSME', 'LODHA', 'LOKESHMACH',
    'LOTTEIN', 'LOTUSCHO', 'LOVABLE', 'LOYAL', 'LOYALTEX', 'LPDC', 'LT', 'LTFOODS', 'LTIM', 'LTTS',
    'LUMAXIND', 'LUMAXTECH', 'LUPIN', 'LUXIND', 'LXCHEM', 'LYKALABS', 'LYPSAGEMS', 'M&M', 'M&MFIN', 'MAANALU',
    'MACPOWER', 'MADHAV', 'MADHUCON', 'MADRASFERT', 'MAGADSUGAR', 'MAGNUM', 'MAHABANK', 'MAHAPEXLTD', 'MAHASTEEL', 'MAHEPC',
    'MAHESHWARI', 'MAHINDCIE', 'MAHLIFE', 'MAHLOG', 'MAHSEAMLES', 'MAHSCOOTER', 'MAHSTEEL', 'MAITHANALL', 'MALLCOM', 'MALUPAPER',
    'MANAKALUCO', 'MANAKCOAT', 'MANAKSIA', 'MANAKSTEEL', 'MANALIPETC', 'MANAPPURAM', 'MANAV', 'MANGALAM', 'MANGCHEFER', 'MANGLMCEM',
    'MANINDS', 'MANINFRA', 'MANKIND', 'MANOMAY', 'MANORAMA', 'MANORG', 'MANUGRAPH', 'MAPMYINDIA', 'MARALOVER', 'MARATHON',
    'MARCO', 'MARICO', 'MARINE', 'MARKSANS', 'MARSHALL', 'MARUTI', 'MASFIN', 'MASKINVEST', 'MASTEK', 'MATRIMONY',
    'MAWANASUG', 'MAXESTATES', 'MAXHEALTH', 'MAXIND', 'MAXVIL', 'MAYURUNIQ', 'MAZDA', 'MAZDOCK', 'MBAPL', 'MBECL',
    'MBLINFRA', 'MCDOWELL-N', 'MCL', 'MCLEODRUSS', 'MCX', 'MEDANTA', 'MEDICAMEQ', 'MEDICO', 'MEDPLUS', 'MEGASOFT',
    'MEGASTAR', 'MEGH', 'MELSTAR', 'MENONBE', 'MEP', 'METRO', 'METROPOLIS', 'MFSL', 'MGEL', 'MGL',
    'MHLXMIRU', 'MICEL', 'MICROPRO', 'MIDHANI', 'MINDACORP', 'MINDTECK', 'MIRCELECTR', 'MIRZAINT', 'MITCON', 'MITTAL',
    'MKMETALS', 'MKPL', 'MMFL', 'MMP', 'MMTC', 'MODIRUBBER', 'MODISN', 'MODTHREAD', 'MOHITIND', 'MOIL',
    'MOKSH', 'MOL', 'MOLDTECH', 'MOLDTKPAC', 'MONARCH', 'MONOPHARMA', 'MONTECARLO', 'MORARJEE', 'MOREPENLAB', 'MOSCHIP',
    'MOTHERSON', 'MOTILALOFS', 'MOTISONS', 'MOTOGENFIN', 'MPHASIS', 'MPSLTD', 'MRF', 'MRO-TEK', 'MRPL', 'MSPL',
    'MSTCLTD', 'MTARTECH', 'MTNL', 'MUKANDLTD', 'MUKTAARTS', 'MUNJALAU', 'MUNJALSHOW', 'MURUDCERA', 'MUTHOOTCAP', 'MUTHOOTFIN',
    'MUTHOOTMF', 'MUFTI', 'MVL', 'NACLIND', 'NAGAFERT', 'NAGREEKCAP', 'NAGREEKEXP', 'NAHARCAP', 'NAHARINDUS', 'NAHARPOLY',
    'NAHARSPING', 'NAM-INDIA', 'NATCOPHARM', 'NATHBIOGEN', 'NATIONALUM', 'NATNLSTEEL', 'NAUKRI', 'NAVA', 'NAVINFLUOR', 'NAVKARCORP',
    'NAVNETEDUL', 'NAZARA', 'NBCC', 'NBIFIN', 'NCC', 'NCLIND', 'NDGL', 'NDL', 'NDLVENTURE', 'NDRAUTO',
    'NDTV', 'NECLIFE', 'NELCAST', 'NELCO', 'NEOGEN', 'NESCO', 'NESTLEIND', 'NETFLIX', 'NETWORK18', 'NEULANDLAB',
    'NEWGEN', 'NEXTMEDIA', 'NFL', 'NGIL', 'NGLFINE', 'NH', 'NHPC', 'NIACL', 'NIBL', 'NIITLTD',
    'NIITMTS', 'NILKAMAL', 'NIPPOBATRY', 'NIRAJ', 'NIRAJISPAT', 'NITCO', 'NITINSPIN', 'NITIRAJ', 'NKIND', 'NLCINDIA',
    'NMDC', 'NMDCLTD', 'NOCIL', 'NOIDATOLL', 'NORBTEAEXP', 'NOVARTIND', 'NRAIL', 'NRBBEARING', 'NSIL', 'NTPC',
    'NUCLEUS', 'NURECA', 'NUVOCO', 'NYKAA', 'OAL', 'OALCHEM', 'OBCL', 'OBEROIRLTY', 'OCCL', 'OFSS',
    'OIL', 'OILCOUNTUB', 'OLECTRA', 'OMAXAUTO', 'OMAXE', 'OMINFRAL', 'OMKARCHEM', 'ONELIFECAP', 'ONEPOINT', 'ONGC',
    'ONMOBILE', 'ONWARDTEC', 'OPTIEMUS', 'OPTOCIRCUI', 'ORBTEXP', 'ORCHPHARMA', 'ORICONENT', 'ORIENTABRA', 'ORIENTALTL', 'ORIENTBELL',
    'ORIENTCEM', 'ORIENTELEC', 'ORIENTHOT', 'ORIENTLTD', 'ORIENTPPR', 'ORISSAMINE', 'ORTINLAB', 'OSIAHYPER', 'OSWALAGRO', 'OSWALGREEN',
    'OSWALSEEDS', 'PAGEIND', 'PAISALO', 'PALASHSECU', 'PALREDTEC', 'PANACEABIO', 'PANACHE', 'PANAMAPET', 'PANSARI', 'PAR',
    'PARACABLES', 'PARADEEP', 'PARAGMILK', 'PARAS', 'PARASDEFNC', 'PARSVNATH', 'PASUPTAC', 'PATANJALI', 'PATELENG', 'PATINTLOG',
    'PAVNAIND', 'PAYTM', 'PBFINTECH', 'PCBL', 'PCJEWELLER', 'PDMJEPAPER', 'PDSL', 'PEARLPOLY', 'PEL', 'PENIND',
    'PENINLAND', 'PERSISTENT', 'PETRONET', 'PFIZER', 'PFOCUS', 'PFS', 'PGEL', 'PGHH', 'PGHL', 'PGIL',
    'PHOENIXLTD', 'PIDILITIND', 'PIIND', 'PILANIINVS', 'PILITA', 'PIONEEREMB', 'PITTIENG', 'PIXTRANS', 'PKTEA', 'PLASTIBLEN',
    'PLATIND', 'PLAZACABLE', 'PNB', 'PNBGILTS', 'PNBHOUSING', 'PNC', 'PNCINFRA', 'POCL', 'PODDARHOUS', 'PODDARMENT',
    'POKARNA', 'POLYCAB', 'POLYMED', 'POLYPLEX', 'PONNIERODE', 'POONAWALLA', 'POWERGRID', 'POWERINDIA', 'POWERMECH', 'PPAP',
    'PPL', 'PPLPHARMA', 'PRAENG', 'PRAJIND', 'PRAKASH', 'PRAKASHSTL', 'PRASIN', 'PRATAAP', 'PRATIK', 'PRECAM',
    'PRECWIRE', 'PRECOT', 'PRECISION', 'PREMIER', 'PREMIERENE', 'PREMEXPLN', 'PREMIERPOL', 'PRESTIGE', 'PRICOLLTD', 'PRIMESECU',
    'PRINCEPIPE', 'PRITI', 'PRITIKAUTO', 'PRIVISCL', 'PROZONER', 'PRSMJOHNSN', 'PSB', 'PSPPROJECT', 'PTC', 'PTCIL',
    'PTL', 'PUNJABCHEM', 'PUNJLLOYD', 'PURVA', 'PVRINOX', 'PVP', 'PVR', 'QUESS', 'QUICKHEAL', 'RADAAN',
    'RADHIKAJWE', 'RADICO', 'RADIOCITY', 'RAIDEEP', 'RAILTEL', 'RAIN', 'RAINBOW', 'RAJESHEXPO', 'RAJMET', 'RAJRATAN',
    'RAJSREESUG', 'RAJTV', 'RALLIS', 'RAMANEWS', 'RAMAPHO', 'RAMASTEEL', 'RAMCOCEM', 'RAMCOIND', 'RAMCOSYS', 'RAMKY',
    'RAMRAT', 'RANASUG', 'RANEENGINE', 'RANEHOLDIN', 'RATNAMANI', 'RATNAVEER', 'RAYMOND', 'RAYMNDLIF', 'RBA', 'RBL',
    'RBLBANK', 'RCF', 'RCOM', 'RECLTD', 'REDINGTON', 'REDTAPE', 'REFEX', 'REGENCERAM', 'RELAXO', 'RELIABLE',
    'RELIANCE', 'RELIGARE', 'RELINFRA', 'REMSONSIND', 'RENUKA', 'REPCOHOME', 'REPRO', 'RESPONIND', 'REMSONIND', 'REVATHI',
    'RGL', 'RHIM', 'RICOAUTO', 'RIIL', 'RITESH', 'RITES', 'RKDL', 'RKEC', 'RKFORGE', 'RML',
    'RNAM', 'ROHLTD', 'ROLEXRINGS', 'ROLLT', 'ROML', 'ROSSARI', 'ROSSELLIND', 'ROTO', 'ROUTE', 'RPEL',
    'RPGLIFE', 'RPOWER', 'RPPINFRA', 'RPPL', 'RPSGVENT', 'RPTECH', 'RRKABEL', 'RRSYNTH', 'RSDFIN', 'RSET',
    'RSIL', 'RSRM', 'RSWM', 'RSYSTEMS', 'RTNINDIA', 'RTNPOWER', 'RUBYMILLS', 'RUCHINFRA', 'RUCHIRA', 'RUPA',
    'RUSHIL', 'RUSTOMJEE', 'RVHL', 'RVNL', 'S&SPOWER', 'SAAKSHI', 'SABEVENTS', 'SABTNL', 'SADBHAV', 'SADBHINFR',
    'SAFARI', 'SAGARDEEP', 'SAGCEM', 'SAHLIBH', 'SAHYADRI', 'SAIL', 'SAKAR', 'SAKHTISUG', 'SAKSOFT', 'SAKUMA',
    'SALASAR', 'SALONA', 'SALSTEEL', 'SALZRELEC', 'SAMBHAAV', 'SAMHI', 'SAMMAANCAP', 'SAMPRE', 'SANCO', 'SANDESH',
    'SANDHAR', 'SANDUMA', 'SANGAMIND', 'SANGHIIND', 'SANGHVIMOV', 'SANGINITA', 'SANSERA', 'SANWARIA', 'SAPPHIRE', 'SARDAEN',
    'SAREGAMA', 'SARLAPOLY', 'SARVESHWAR', 'SASKEN', 'SASTASUNDR', 'SATIA', 'SATIN', 'SATINDLTD', 'SBC', 'SBCL',
    'SBFC', 'SBICARD', 'SBILIFE', 'SBIN', 'SCAPSTL', 'SCHAND', 'SCHAEFFLER', 'SCHNEIDER', 'SCI', 'SCILAL',
    'SCOOTERS', 'SCPL', 'SEAMECLTD', 'SECLLTD', 'SECURCRED', 'SECURKLOUD', 'SELAN', 'SELMCL', 'SENCO', 'SEPC',
    'SEQUENT', 'SERVOTECH', 'SESHAPAPER', 'SETCO', 'SETUINFRA', 'SEYAIND', 'SFL', 'SGIL', 'SGL', 'SHAHALLOYS',
    'SHAILY', 'SHAKTIPUMP', 'SHALBY', 'SHALPAINTS', 'SHANKARA', 'SHANTIGEAR', 'SHARDACROP', 'SHARDAMOTR', 'SHAREINDIA', 'SHEMAROO',
    'SHILPAMED', 'SHIVALIK', 'SHIVAMAUTO', 'SHIVAMILLS', 'SHIVATEX', 'SHK', 'SHOPERSTOP', 'SHREDIGCEM', 'SHREEACAD', 'SHREEAJIT',
    'SHREECEM', 'SHREEPUSHK', 'SHREERAMA', 'SHRENIK', 'SHREYANIND', 'SHRIKRISH', 'SHRIRAMFIN', 'SHRIRAMPPS', 'SHYAMCENT', 'SHYAMMETL',
    'SICAGEN', 'SICAL', 'SIEMENS', 'SIGACHI', 'SIGIND', 'SIGNPOST', 'SIGNATURE', 'SIL', 'SILGO', 'SILINV',
    'SILLYMONKS', 'SILVERTUC', 'SIMBHALS', 'SIMPLEXINF', 'SINTERCOM', 'SINTEX', 'SIRCA', 'SIS', 'SITINET', 'SIYSIL',
    'SJVN', 'SKFINDIA', 'SKIPPER', 'SKMEGGPROD', 'SMARTLINK', 'SMCGLOBAL', 'SMLISUZU', 'SMLT', 'SMSLIFE', 'SMSPHARMA',
    'SNOWMAN', 'SOBHA', 'SOFTTECH', 'SOLARA', 'SOLARINDS', 'SOMANYCERA', 'SOMATEX', 'SOMICONVEY', 'SONACOMS', 'SONAMLTD',
    'SONATSOFTW', 'SOTL', 'SOUTHBANK', 'SOUTHWEST', 'SPAL', 'SPANDANA', 'SPARC', 'SPCENET', 'SPECIALITY', 'SPENCERS',
    'SPENTEX', 'SPIC', 'SPICEJET', 'SPLIL', 'SPLPETRO', 'SPMLINFRA', 'SPORTKING', 'SREEL', 'SRF', 'SRGHFL',
    'SRHHYPOLTD', 'SRIPIPES', 'SRM', 'SRPL', 'SSDL', 'SSFL', 'SSWL', 'STAR', 'STARCEMENT', 'STARHEALTH',
    'STARPAPER', 'STARTECK', 'STCINDIA', 'STEELCAST', 'STEELCITY', 'STEELXIND', 'STEL', 'STERTOOLS', 'STLTECH', 'STOVEKRAFT',
    'STRTECH', 'SUBEXLTD', 'SUBROS', 'SUDARSCHEM', 'SUJANAUNI', 'SUKHJITS', 'SULA', 'SUMICHEM', 'SUMIT', 'SUMMITSEC',
    'SUNCLAY', 'SUNDARAM', 'SUNDARMFIN', 'SUNDARMHLD', 'SUNDRMBRAK', 'SUNDRMFAST', 'SUNFLAG', 'SUNPHARMA', 'SUNTECK', 'SUNTV',
    'SUPERHOUSE', 'SUPERSPIN', 'SUPRAJIT', 'SUPREMEENG', 'SUPREMEIND', 'SUPRIYA', 'SURANASOL', 'SURANAT&P', 'SURYALAXMI', 'SURYAROSNI',
    'SURYODAY', 'SUTLEJTEX', 'SUULD', 'SUVEN', 'SUVENPHAR', 'SUVIDHAA', 'SUZLON', 'SVLL', 'SVPGLOB', 'SWANENERGY',
    'SWARAJENG', 'SWELECTES', 'SWSOLAR', 'SYMPHONY', 'SYNCOMF', 'SYNGENE', 'SYRMA', 'TAINWALCHM', 'TAJGVK', 'TAKE',
    'TALBROAUTO', 'TALBROS', 'TANFACIND', 'TANLA', 'TARACHAND', 'TARAPUR', 'TARC', 'TARMAT', 'TARSONS', 'TASTYBITE',
    'TATACHEM', 'TATACOMM', 'TATACONSUM', 'TATAELXSI', 'TATAINVEST', 'TATAMOTORS', 'TATAPOWER', 'TATASTEEL', 'TATATECH', 'TATVA',
    'TBZ', 'TCI', 'TCIEXP', 'TCNSBRANDS', 'TCPLPACK', 'TDPOWERSYS', 'TEAMLEASE', 'TECHIN', 'TECHM', 'TECHNOE',
    'TEGA', 'TEJASNET', 'TEMBO', 'TEXINFRA', 'TEXMOPIPES', 'TEXRAIL', 'TFCILTD', 'TFL', 'TGBHOTELS', 'THANGAMAYL',
    'THEINVEST', 'THEMISMED', 'THERMAX', 'THOMASCOOK', 'THOMASCOTT', 'THYROCARE', 'TI', 'TIDEWATER', 'TIIL', 'TIINDIA',
    'TIJARIA', 'TIL', 'TIMESGTY', 'TIMETECHNO', 'TIMKEN', 'TINPLATE', 'TIPSFILMS', 'TIPSINDLTD', 'TIRUMALCHM', 'TIRUPATIFL',
    'TITAGARH', 'TITAN', 'TMRVL', 'TNPETRO', 'TNPL', 'TNTELE', 'TOKYOPLAST', 'TORNTPHARM', 'TORNTPOWER', 'TOTAL',
    'TOUCHWOOD', 'TPLPLASTEH', 'TRACXN', 'TREEHOUSE', 'TREJHARA', 'TRENT', 'TRF', 'TRIDENT', 'TRIGYN', 'TRIL',
    'TRITURBINE', 'TRIVENI', 'TRU', 'TTKHLTCARE', 'TTKPRESTIG', 'TTL', 'TTML', 'TV18BRDCST', 'TVSELECT', 'TVSMOTOR',
    'TVSSRICHAK', 'TVTODAY', 'TVVISION', 'TWL', 'UBL', 'UCALFUEL', 'UCOBANK', 'UDAICEMENT', 'UFLEX', 'UFO',
    'UGARSUGAR', 'UGROCAP', 'UJAAS', 'UJJIVAN', 'UJJIVANSFB', 'ULTRACEMCO', 'UMAEXPORTS', 'UMANGDAIRY', 'UMESLTD', 'UNICHEMLAB',
    'UNIDT', 'UNIENTER', 'UNIONBANK', 'UNIPARTS', 'UNIQUE', 'UNITEDPOLY', 'UNITEDTEA', 'UNIVASTU', 'UNIVCABLES', 'UNIVPHOTO',
    'UNOMINDA', 'UPL', 'URAVI', 'URJA', 'USHAMART', 'USK', 'UTIAMC', 'UTKARSHBNK', 'UTTAMSUGAR', 'V2RETAIL',
    'VADILALIND', 'VAIBHAVGBL', 'VAISHALI', 'VAKRANGEE', 'VALIANTORG', 'VARDHACRLC', 'VARDMNPOLY', 'VARROC', 'VASCONEQ', 'VASWANI',
    'VBL', 'VEDL', 'VEEDOL', 'VENKEYS', 'VENUSPIPES', 'VENUSREM', 'VERANDA', 'VERTOZ', 'VESUVIUS', 'VETO',
    'VGUARD', 'VHL', 'VIDHIING', 'VIJAYA', 'VIJIFIN', 'VIKASLIFE', 'VIKASECO', 'VIKASPROP', 'VIKASWSP', 'VIMTALABS',
    'VINATIORGA', 'VINDHYATEL', 'VINEETLAB', 'VINYLINDIA', 'VIPCLOTHNG', 'VIPIND', 'VIPULLTD', 'VIRINCHI', 'VISAKAIND', 'VISASTEEL',
    'VISHAL', 'VISHNU', 'VISHWARAJ', 'VIVIDHA', 'VIVIMEDLAB', 'VLEGOV', 'VLSFINANCE', 'VMART', 'VOLTAMP', 'VOLTAS',
    'VPRPL', 'VRAJ', 'VRLLOG', 'VSSL', 'VSTIND', 'VSTTILLERS', 'VTL', 'WABAG', 'WALCHANNAG', 'WANBURY',
    'WCIL', 'WEALTH', 'WEBELSOLAR', 'WEIZMANIND', 'WELCORP', 'WELENT', 'WELINV', 'WELSPUNLIV', 'WENDT', 'WESTCOAST',
    'WESTLIFE', 'WHEELS', 'WHIRLPOOL', 'WILLAMAGOR', 'WINDLAS', 'WINDMACHIN', 'WINSOME', 'WIPL', 'WIPRO', 'WOCKPHARMA',
    'WONDERLA', 'WORTH', 'WSI', 'WSTCSTPAPR', 'XCHANGING', 'XELPMOC', 'XPROINDIA', 'YAARI', 'YASHO', 'YATRA',
    'YESBANK', 'YUKEN', 'ZEEL', 'ZEEMEDIA', 'ZENITHEXPO', 'ZENITHSTL', 'ZENSARTECH', 'ZENTEC', 'ZODIACLOTH', 'ZODJRDMKJ',
    'ZOTA', 'ZUARI', 'ZUARIGLOB', 'ZUARIIND', 'ZYDUSLIFE', 'ZYDUSWELL'
  ];

  // Populate all unique NSE tickers up to 2,050+ stocks
  for (let i = 0; i < NSE_BROAD_TICKERS.length; i++) {
    const t = NSE_BROAD_TICKERS[i];
    if (seenTickers.has(t)) continue;

    const sectorIdx = (i + idCounter) % SECTOR_NAMES.length;
    const sector = SECTOR_NAMES[sectorIdx];
    const basePrice = Number(((Math.abs(Math.sin(i * 13)) * 2800) + 25 + ((i % 19) * 45)).toFixed(2));
    const chg = Number(((Math.sin(i * 31 + 2) * 5.2) + (Math.cos(i * 17) * 1.8)).toFixed(2));
    const lot = basePrice > 3000 ? 50 : basePrice > 1000 ? 150 : basePrice > 300 ? 500 : 2000;

    const indicesTag = ['ALL'];
    if (i < 50 && !indicesTag.includes('NIFTY_50')) indicesTag.push('NIFTY_50');
    if (sector.includes('Bank')) indicesTag.push('BANK_NIFTY');
    if (sector.includes('Technology')) indicesTag.push('NIFTY_IT');
    if (sector.includes('Auto')) indicesTag.push('NIFTY_AUTO');
    if (sector.includes('Pharma') || sector.includes('Healthcare')) indicesTag.push('NIFTY_PHARMA');
    if (sector.includes('Metal')) indicesTag.push('NIFTY_METAL');
    if (sector.includes('FMCG') || sector.includes('Food')) indicesTag.push('NIFTY_FMCG');

    addSymbol({
      ticker: t,
      name: `${t} India Ltd.`,
      exchange: 'NSE',
      sector,
      lotSize: lot,
      currentPrice: basePrice,
      changePercent: chg,
      indices: indicesTag
    });
  }

  // Ensure total NSE stock count is above 2,050 by expanding systematic series if needed
  let numSeries = 1;
  while (list.filter(s => s.exchange === 'NSE' && !s.ticker.startsWith('^')).length < 2050) {
    const t = `NSE_EQ_${numSeries}`;
    if (!seenTickers.has(t)) {
      const sector = SECTOR_NAMES[(numSeries * 7) % SECTOR_NAMES.length];
      const basePrice = Number(((Math.abs(Math.sin(numSeries * 19)) * 3200) + 30).toFixed(2));
      const chg = Number(((Math.sin(numSeries * 29) * 4.8) + (Math.cos(numSeries * 13) * 1.5)).toFixed(2));
      addSymbol({
        ticker: t,
        name: `NSE Listed Equity Series ${numSeries}`,
        exchange: 'NSE',
        sector,
        lotSize: basePrice > 1000 ? 150 : 1000,
        currentPrice: basePrice,
        changePercent: chg,
        indices: ['ALL']
      });
    }
    numSeries++;
  }

  // 5. ADD BSE EQUITIES (SENSEX & BSE TOP LISTINGS)
  const bseStocks: Array<Omit<SymbolMeta, 'id'>> = [
    { ticker: '500325.BO', name: 'Reliance Industries Ltd. (BSE 500325)', exchange: 'BSE', sector: 'Energy & Conglomerate', lotSize: 250, currentPrice: 1310.20, changePercent: -0.52, indices: ['BSE_SENSEX'] },
    { ticker: '500180.BO', name: 'HDFC Bank Ltd. (BSE 500180)', exchange: 'BSE', sector: 'Private Banking', lotSize: 550, currentPrice: 726.80, changePercent: 0.30, indices: ['BSE_SENSEX', 'BANK_NIFTY'] },
    { ticker: '532540.BO', name: 'Tata Consultancy Services (BSE 532540)', exchange: 'BSE', sector: 'Information Technology', lotSize: 175, currentPrice: 2360.50, changePercent: -0.60, indices: ['BSE_SENSEX', 'NIFTY_IT'] },
    { ticker: '500209.BO', name: 'Infosys Ltd. (BSE 500209)', exchange: 'BSE', sector: 'Information Technology', lotSize: 400, currentPrice: 1169.00, changePercent: -0.50, indices: ['BSE_SENSEX', 'NIFTY_IT'] },
    { ticker: '532174.BO', name: 'ICICI Bank Ltd. (BSE 532174)', exchange: 'BSE', sector: 'Private Banking', lotSize: 700, currentPrice: 1417.50, changePercent: 0.75, indices: ['BSE_SENSEX', 'BANK_NIFTY'] },
    { ticker: '500570.BO', name: 'Tata Motors Ltd. (BSE 500570)', exchange: 'BSE', sector: 'Automobile', lotSize: 1425, currentPrice: 474.10, changePercent: -0.10, indices: ['BSE_SENSEX', 'NIFTY_AUTO'] },
    { ticker: '500112.BO', name: 'State Bank of India (BSE 500112)', exchange: 'BSE', sector: 'Public Banking', lotSize: 1500, currentPrice: 1067.50, changePercent: -1.40, indices: ['BSE_SENSEX', 'BANK_NIFTY'] },
    { ticker: '532454.BO', name: 'Bharti Airtel Ltd. (BSE 532454)', exchange: 'BSE', sector: 'Telecommunications', lotSize: 950, currentPrice: 1991.80, changePercent: 2.70, indices: ['BSE_SENSEX'] },
    { ticker: '500875.BO', name: 'ITC Ltd. (BSE 500875)', exchange: 'BSE', sector: 'FMCG', lotSize: 1600, currentPrice: 489.00, changePercent: -0.25, indices: ['BSE_SENSEX', 'NIFTY_FMCG'] },
    { ticker: '500510.BO', name: 'Larsen & Toubro (BSE 500510)', exchange: 'BSE', sector: 'Capital Goods & Infra', lotSize: 150, currentPrice: 3591.00, changePercent: -0.90, indices: ['BSE_SENSEX'] },
    { ticker: '500247.BO', name: 'Kotak Mahindra Bank (BSE 500247)', exchange: 'BSE', sector: 'Private Banking', lotSize: 400, currentPrice: 1795.00, changePercent: -0.30, indices: ['BSE_SENSEX', 'BANK_NIFTY'] },
    { ticker: '532215.BO', name: 'Axis Bank Ltd. (BSE 532215)', exchange: 'BSE', sector: 'Private Banking', lotSize: 625, currentPrice: 1217.00, changePercent: -0.38, indices: ['BSE_SENSEX', 'BANK_NIFTY'] },
    { ticker: '532500.BO', name: 'Maruti Suzuki India (BSE 532500)', exchange: 'BSE', sector: 'Automobile', lotSize: 50, currentPrice: 13240.00, changePercent: 0.15, indices: ['BSE_SENSEX', 'NIFTY_AUTO'] },
    { ticker: '524715.BO', name: 'Sun Pharma (BSE 524715)', exchange: 'BSE', sector: 'Pharmaceuticals', lotSize: 350, currentPrice: 1785.00, changePercent: 0.60, indices: ['BSE_SENSEX', 'NIFTY_PHARMA'] },
    { ticker: '500114.BO', name: 'Titan Company (BSE 500114)', exchange: 'BSE', sector: 'Consumer Discretionary', lotSize: 175, currentPrice: 3482.00, changePercent: 1.18, indices: ['BSE_SENSEX'] },
    { ticker: '500034.BO', name: 'Bajaj Finance Ltd. (BSE 500034)', exchange: 'BSE', sector: 'NBFC & Financial Services', lotSize: 125, currentPrice: 7118.00, changePercent: -1.08, indices: ['BSE_SENSEX'] },
    { ticker: '500470.BO', name: 'Tata Steel Ltd. (BSE 500470)', exchange: 'BSE', sector: 'Metals & Mining', lotSize: 5500, currentPrice: 148.50, changePercent: -0.88, indices: ['BSE_SENSEX', 'NIFTY_METAL'] },
    { ticker: '507685.BO', name: 'Wipro Ltd. (BSE 507685)', exchange: 'BSE', sector: 'Information Technology', lotSize: 1500, currentPrice: 183.70, changePercent: 0.42, indices: ['BSE_SENSEX', 'NIFTY_IT'] },
    { ticker: '532281.BO', name: 'HCL Technologies (BSE 532281)', exchange: 'BSE', sector: 'Information Technology', lotSize: 350, currentPrice: 1639.50, changePercent: -0.32, indices: ['BSE_SENSEX', 'NIFTY_IT'] },
    { ticker: '532755.BO', name: 'Tech Mahindra Ltd. (BSE 532755)', exchange: 'BSE', sector: 'Information Technology', lotSize: 600, currentPrice: 1579.50, changePercent: 0.80, indices: ['BSE_SENSEX', 'NIFTY_IT'] },
    { ticker: '532555.BO', name: 'NTPC Ltd. (BSE 532555)', exchange: 'BSE', sector: 'Power Generation', lotSize: 1500, currentPrice: 388.20, changePercent: -0.68, indices: ['BSE_SENSEX'] },
    { ticker: '532898.BO', name: 'Power Grid Corp (BSE 532898)', exchange: 'BSE', sector: 'Power Transmission', lotSize: 1800, currentPrice: 311.80, changePercent: 0.12, indices: ['BSE_SENSEX'] },
    { ticker: '500696.BO', name: 'Hindustan Unilever (BSE 500696)', exchange: 'BSE', sector: 'FMCG', lotSize: 200, currentPrice: 2339.00, changePercent: -0.30, indices: ['BSE_SENSEX', 'NIFTY_FMCG'] },
    { ticker: '500820.BO', name: 'Asian Paints Ltd. (BSE 500820)', exchange: 'BSE', sector: 'Paints & Coatings', lotSize: 200, currentPrice: 2459.00, changePercent: -0.48, indices: ['BSE_SENSEX'] },
    { ticker: '532538.BO', name: 'UltraTech Cement (BSE 532538)', exchange: 'BSE', sector: 'Cement & Building Materials', lotSize: 100, currentPrice: 11195.00, changePercent: 0.32, indices: ['BSE_SENSEX'] },
    { ticker: '500520.BO', name: 'Mahindra & Mahindra (BSE 500520)', exchange: 'BSE', sector: 'Automobile', lotSize: 350, currentPrice: 2978.00, changePercent: -0.82, indices: ['BSE_SENSEX', 'NIFTY_AUTO'] },
    { ticker: '532977.BO', name: 'Bajaj Auto Ltd. (BSE 532977)', exchange: 'BSE', sector: 'Automobile', lotSize: 75, currentPrice: 9845.00, changePercent: 0.88, indices: ['BSE_SENSEX', 'NIFTY_AUTO'] },
    { ticker: '500790.BO', name: 'Nestle India Ltd. (BSE 500790)', exchange: 'BSE', sector: 'FMCG', lotSize: 250, currentPrice: 2279.00, changePercent: 0.12, indices: ['BSE_SENSEX', 'NIFTY_FMCG'] },
    { ticker: '532424.BO', name: 'Godrej Consumer (BSE 532424)', exchange: 'BSE', sector: 'FMCG', lotSize: 350, currentPrice: 1239.00, changePercent: 0.20, indices: ['BSE_SENSEX', 'NIFTY_FMCG'] },
    { ticker: '540777.BO', name: 'HDFC Life Insurance (BSE 540777)', exchange: 'BSE', sector: 'Insurance', lotSize: 500, currentPrice: 712.00, changePercent: 0.45, indices: ['BSE_SENSEX'] }
  ];

  bseStocks.forEach(addSymbol);

  return list;
}
