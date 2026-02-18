declare namespace google {
  export const maps: any;
}
// let googleMapsPromise: Promise<any> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  return new Promise((resolve, reject) => {
    if ("google" in window && window.google && window.google.maps) {
      resolve(window.google.maps);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;

    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject("Google Maps failed to load");

    document.head.appendChild(script);
  });
}
