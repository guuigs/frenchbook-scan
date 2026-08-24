/**
 * Jeu d'icônes minimal, dans l'esprit Geist : trait de 1,5 px sur une grille de
 * 16, pas de remplissage, pas d'émoji. Elles héritent de la couleur du texte.
 */
type IconProps = { className?: string };

function Svg({ children, className = "" }: IconProps & { children: React.ReactNode }) {
  /*
   * La taille par défaut ne doit pas disparaître quand l'appelant ne passe
   * qu'une couleur. Elle vivait dans la valeur par défaut du paramètre, donc
   * `<IconAlert className="text-danger" />` la remplaçait : l'icône prenait
   * alors la taille de la police du parent — un triangle d'alerte de cent
   * pixels au milieu d'une feuille de validation.
   */
  const size = /(^|\s)[hw]-/.test(className) ? "" : "h-4 w-4";

  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${size} ${className}`.trim()}
    >
      {children}
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5 15 14H1L8 2.5Z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.8h.01" />
    </Svg>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 5.5h2.2l1-1.8h6.6l1 1.8h2.2v8h-13v-8Z" />
      <circle cx="8" cy="9" r="2.5" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <circle cx="5.5" cy="6" r="1" />
      <path d="M2 11.5 6 8l3.5 3 2-1.5 2.5 2" />
    </Svg>
  );
}

/** Curseurs de réglage plutôt qu'un engrenage : à 16 px, les dents d'un
 *  engrenage se lisent comme un soleil. */
export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 4.5h3M8.5 4.5h5.5M2 11.5h5.5M11 11.5h3" />
      <circle cx="6.75" cy="4.5" r="1.75" />
      <circle cx="9.25" cy="11.5" r="1.75" />
    </Svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 4h9M5.5 8h9M5.5 12h9M2 4h.01M2 8h.01M2 12h.01" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3.5 5.5 8 10 12.5" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}

export function IconMinus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8h10" />
    </Svg>
  );
}

export function IconShare(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 10.5V2M5 4.8 8 1.8l3 3" />
      <path d="M2.5 9.5v3.2c0 .4.3.8.8.8h9.4c.5 0 .8-.4.8-.8V9.5" />
    </Svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
      <path d="m2.5 4.75 5.5 4 5.5-4" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </Svg>
  );
}

export function IconBox(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.5 14 4.5v7L8 14.5 2 11.5v-7L8 1.5Z" />
      <path d="M2 4.5 8 7.5l6-3M8 7.5v7" />
    </Svg>
  );
}

export function IconFileSpreadsheet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 1.5h5.5L12.5 4.5v10a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
      <path d="M4.5 8h6M4.5 10.5h6M7.5 8v5" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9.5h6.8L12 4" />
    </Svg>
  );
}
