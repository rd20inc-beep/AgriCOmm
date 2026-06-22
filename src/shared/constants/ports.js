// Common sea ports for the buyer "port" field. Free text is also allowed (the
// field is a datalist input — select a suggestion or type a new one).
export const PORTS = [
  'Karachi', 'Port Qasim', 'Jebel Ali (Dubai)', 'Abu Dhabi', 'Sharjah',
  'Dammam', 'Jeddah', 'Riyadh (Dry Port)', 'Doha (Hamad)', 'Kuwait (Shuwaikh)',
  'Bahrain (Khalifa Bin Salman)', 'Sohar', 'Muscat', 'Aden', 'Hodeidah',
  'Bandar Abbas', 'Basra (Umm Qasr)', 'Aqaba', 'Beirut', 'Mersin', 'Istanbul',
  'Mombasa', 'Dar es Salaam', 'Djibouti', 'Berbera', 'Port Sudan', 'Alexandria',
  'Damietta', 'Lagos (Apapa)', 'Tema', 'Abidjan', 'Dakar', 'Cotonou', 'Lomé',
  'Durban', 'Cape Town', 'Maputo', 'Toamasina', 'Port Louis',
  'Klaipeda', 'Hamburg', 'Rotterdam', 'Antwerp', 'Felixstowe', 'Genoa',
  'Barcelona', 'Valencia', 'Gioia Tauro', 'Constanta', 'Odessa',
  'Colombo', 'Chittagong', 'Mongla', 'Nhava Sheva', 'Mundra', 'Chennai',
  'Singapore', 'Port Klang', 'Tanjung Pelepas', 'Jakarta (Tanjung Priok)',
  'Manila', 'Ho Chi Minh (Cat Lai)', 'Yangon', 'Bangkok (Laem Chabang)',
  'Hong Kong', 'Shanghai', 'New York', 'Houston', 'Los Angeles', 'Toronto',
];

export const PORT_OPTIONS = PORTS.map((p) => ({ value: p, label: p }));
