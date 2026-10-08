import {ConsumerItem} from '../return-engine';
export function stylingSuggestions(item:ConsumerItem){
 if(item.type==='Denim Jacket')return ['Layer over a plain tee with your existing trousers.','Wear open over a dress for a lighter layer.','Pair with a knit on cooler days.'];
 if(item.type==='Cotton T-shirt')return ['Tuck into trousers you already own.','Layer under an open shirt.','Pair with relaxed shorts for everyday wear.'];
 return ['Pair with a crisp shirt already in your wardrobe.','Roll the cuffs and wear with your usual trainers.','Add an existing knit for a different silhouette.'];
}
