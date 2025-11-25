// nameParser.js — lightweight text-based features
(function(global){
  function hashString(s){
    let h=2166136261;
    for(let i=0;i<s.length;i++){h ^= s.charCodeAt(i); h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);}
    return Math.abs(h >>> 0);
  }

  function normalizeName(s){
    return (s||"").trim().replace(/\s+/g," ").normalize("NFKD");
  }

  function countSyllablesNaive(name){
    // heuristic: count vowel groups
    const v = (name||"").toLowerCase().match(/[aeiouy]+/g);
    return v ? Math.max(1, v.length) : 1;
  }

  function consonantVowelRatio(name){
    const letters = (name||"").toLowerCase().replace(/[^a-z]/g,"");
    const vowels = (letters.match(/[aeiou]/g)||[]).length;
    const consonants = Math.max(0, letters.length - vowels);
    return { vowels, consonants, ratio: letters.length ? (consonants/(vowels||1)) : 0 };
  }

  function extractPhonemeHints(name){
    const s = (name||"").toLowerCase();
    const hasRetroflex = /ṭ|ḍ|ṇ|ṭh|dh|kh|gh/.test(s) || /sh|zh|ng/.test(s);
    const consonantClusters = (s.match(/[^aeiou]{2,}/g)||[]).length;
    const vowelGroups = (s.match(/[aeiouy]+/g)||[]).length;
    return { hasRetroflex, consonantClusters, vowelGroups };
  }

  global.nameParser = {
    hashString,
    normalizeName,
    countSyllablesNaive,
    consonantVowelRatio,
    extractPhonemeHints
  };
})(window);
