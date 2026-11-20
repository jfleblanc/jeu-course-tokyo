/** Livraisons : un colis à prendre à un point de la carte et à déposer ailleurs, le plus vite possible. */
export const DELIVERIES = {
  /** Nombre de colis proposés en même temps sur la carte. */
  active: 3,
  /** Un colis que personne ne prend change d'endroit après ce délai (s). */
  moveSeconds: 210,
  /** Rayon du cercle de départ et du cercle d'arrivée (m). */
  radius: 6,
  goalRadius: 9,
  /** Longueur du trajet (m), par les rues. */
  minDistance: 650,
  maxDistance: 1700,
  /** Vitesses moyennes des médailles (m/s) : or, argent, bronze. 20 m/s = 72 km/h de moyenne, circulation comprise. */
  goldSpeed: 20,
  silverSpeed: 16,
  bronzeSpeed: 12,
  /** Les missions, toujours les mêmes (pour que les meilleurs temps veuillent dire quelque chose). */
  names: [
    'Ramen express', 'Pièces de moteur', 'Bouquet de minuit', 'Sushis pour le yacht', 'Jeu vidéo en avant-première', 'Pneus de course',
    'Gâteau d’anniversaire', 'Colis fragile', 'Clés oubliées', 'Disques vinyles', 'Dossier urgent', 'Turbo de rechange',
    'Thé du matin', 'Guitare de concert', 'Casque du pilote', 'Trophée à livrer',
  ],
} as const;
