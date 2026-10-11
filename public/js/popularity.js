// How often hymns are sung: the 50 most reported in SingPraises.net's survey of 16,491
// sacrament meetings in 997 wards, mostly in the United States, mainly in 2017
// (https://singpraises.net/statistics/sacrament-meeting). Hymns (1985) only; the newer
// Hymns for Home and Church came later. Titles and counts as the survey reports them; a title
// listed twice (two tunes) gives both hymns of that name the higher rank.

export const POPULARITY_SOURCE = {
  name: 'SingPraises.net survey of 16,491 sacrament meetings (2017, Hymns 1985)',
  url: 'https://singpraises.net/statistics/sacrament-meeting',
};

const TOP = [
  ['I Stand All Amazed', 939],
  ['In Humility, Our Savior', 846],
  ['Jesus, Once of Humble Birth', 818],
  ['There Is a Green Hill Far Away', 795],
  ['As Now We Take the Sacrament', 764],
  ['How Great the Wisdom and the Love', 742],
  ['God Loved Us, So He Sent His Son', 690],
  ['God, Our Father, Hear Us Pray', 690],
  ['Jesus of Nazareth, Savior and King', 689],
  ["We'll Sing All Hail to Jesus' Name", 686],
  ['O God, the Eternal Father', 682],
  ['Father in Heaven, We Do Believe', 660],
  ['With Humble Heart', 609],
  ['Upon the Cross of Calvary', 606],
  ['Behold the Great Redeemer Die', 601],
  ['Reverently and Meekly Now', 600],
  ['Because I Have Been Given Much', 554],
  ['In Memory of the Crucified', 549],
  ['While of These Emblems We Partake', 541],
  ['He Died! The Great Redeemer Died', 536],
  ['I Know That My Redeemer Lives', 514],
  ['How Firm a Foundation', 509],
  ["'Tis Sweet to Sing the Matchless Love", 502],
  ['Lord, I Would Follow Thee', 486],
  ['We Thank Thee, O God, for a Prophet', 466],
  ['I Believe in Christ', 444],
  ['Now Let Us Rejoice', 443],
  ['High on the Mountain Top', 423],
  ['The Lord Is My Light', 420],
  ['In Remembrance of Thy Suffering', 414],
  ['Come, Follow Me', 413],
  ["'Tis Sweet to Sing the Matchless Love", 410],
  ['Teach Me to Walk in the Light', 406],
  ['While of These Emblems We Partake', 397],
  ['Thy Will, O Lord, Be Done', 392],
  ['Choose the Right', 382],
  ['Count Your Blessings', 369],
  ['Come, Come, Ye Saints', 366],
  ['The Spirit of God', 363],
  ['For the Beauty of the Earth', 360],
  ['Joy to the World', 356],
  ["Our Savior's Love", 351],
  ['Love at Home', 346],
  ['I Need Thee Every Hour', 345],
  ['I Am a Child of God', 344],
  ['Press Forward, Saints', 340],
  ['Redeemer of Israel', 338],
  ['More Holiness Give Me', 337],
  ['Oh, Come, All Ye Faithful', 332],
  ['O Lord of Hosts', 325],
];

const key = (title) => String(title || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();

// Title -> rank (1 = most sung), the higher rank where a title appears twice.
const RANK = new Map();
TOP.forEach(([title], i) => { if (!RANK.has(key(title))) RANK.set(key(title), i + 1); });

// A library song's rank among the most sung, or null. Only songs from Hymns (1985).
export function popularity(collectionId, song) {
  if (collectionId !== 'hymns' && song?.from !== 'Hymns (1985)') return null;
  return RANK.get(key(song?.title)) || null;
}
