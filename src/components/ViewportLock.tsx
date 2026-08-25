"use client";

import { useEffect } from "react";

/**
 * Verrouille l'interface sur la largeur de l'écran.
 *
 * Un poste de scan se tient à une main, souvent avec un livre dans l'autre : le
 * pouce frotte l'écran en permanence, et un pincement involontaire laissait
 * l'application de travers pour le reste du carton. La balise `viewport` suffit
 * sur Android et sur l'application ajoutée à l'écran d'accueil ; dans l'onglet
 * Safari, elle ne suffit pas — iOS ignore délibérément `user-scalable=no`, mais
 * fait passer le pincement par des évènements `gesture*` qui, eux, se refusent.
 *
 * Rien n'est perdu au passage : la photo du bon a son propre agrandissement
 * plein écran (`LineEditor`), qui ne dépend pas du zoom du navigateur.
 */
export function ViewportLock() {
  useEffect(() => {
    const refuser = (evenement: Event) => evenement.preventDefault();
    // Typé en `string[]` : ces évènements sont propres à Safari et n'existent
    // pas dans les types du DOM.
    const gestes: string[] = ["gesturestart", "gesturechange", "gestureend"];
    for (const geste of gestes) {
      // Non passif, sinon `preventDefault` est ignoré.
      document.addEventListener(geste, refuser, { passive: false });
    }

    /*
     * Filet de sécurité, pour le cas où une échelle s'installerait quand même
     * — un chemin de zoom qu'on n'a pas prévu, une version d'iOS qui change
     * d'avis. On ne peut pas remettre l'échelle à 1 par une API : le seul
     * levier est la balise elle-même, et c'est le *changement* de sa valeur,
     * non la valeur, qui force le navigateur à réappliquer l'échelle.
     */
    const ecran = window.visualViewport;
    const balise = document.querySelector('meta[name="viewport"]');
    let minuteur: number | null = null;

    const remettreAPlat = () => {
      if (!ecran || !balise || ecran.scale <= 1.01) return;
      const origine = balise.getAttribute("content");
      if (origine === null || minuteur !== null) return;

      // Clé répétée volontairement : la dernière l'emporte, ce qui évite de
      // réécrire ici la configuration portée par `layout.tsx`.
      balise.setAttribute("content", `${origine}, maximum-scale=0.99`);
      minuteur = window.setTimeout(() => {
        balise.setAttribute("content", origine);
        minuteur = null;
      }, 50);
    };

    ecran?.addEventListener("resize", remettreAPlat);
    ecran?.addEventListener("scroll", remettreAPlat);

    return () => {
      for (const geste of gestes) document.removeEventListener(geste, refuser);
      ecran?.removeEventListener("resize", remettreAPlat);
      ecran?.removeEventListener("scroll", remettreAPlat);
      if (minuteur !== null) window.clearTimeout(minuteur);
    };
  }, []);

  return null;
}
