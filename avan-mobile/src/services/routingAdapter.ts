/**
 * Adaptador de ruteo y geocodificación de AVAN (Fase 5 / TASK-49).
 *
 * Misma firma pública que OpenRouteService para los tres métodos que usa la app,
 * de modo que las pantallas y conversationService sólo cambian el import.
 *
 *   1) Google Maps Platform (si hay clave, API habilitada y circuito cerrado)
 *   2) OpenRouteService / OSRM / ruta local de emergencia (fallback transparente)
 *
 * El fallback es silencioso: el conductor nunca ve un error por cuota o red.
 */

import {
  orsService,
  Coordinates,
  GeocodeResult,
  DisambiguationResult,
  RouteResult,
  StructuredAddressQuery,
} from './orsService';
import * as google from './googleMapsService';
import { AliasService } from './aliasService';

export type RoutingProvider = 'google' | 'ors';

class RoutingService {
  /** Proveedor que respondió en la última llamada (diagnóstico / pruebas). */
  public lastProvider: Record<'geocode' | 'directions' | 'disambiguation', RoutingProvider | null> = {
    geocode: null,
    directions: null,
    disambiguation: null,
  };

  public async geocodeDestination(
    query: string | StructuredAddressQuery,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const queryString = typeof query === 'string' ? query : (query.rawQuery || query.street || '');
    if (queryString && queryString.trim()) {
      const aliasRes = AliasService.resolveDestinationWithAlias(queryString);
      if (aliasRes.isAlias && aliasRes.coordinates) {
        this.lastProvider.geocode = 'ors';
        return [
          {
            id: aliasRes.alias?.id || 'alias-resolved',
            name: aliasRes.resolvedName,
            label: `${aliasRes.resolvedName} - ${aliasRes.alias?.address || 'Ubicación guardada'}`,
            coordinates: aliasRes.coordinates,
            precision: 'exact',
            isFallback: false,
          },
        ];
      }
    }

    if (google.isGoogleMapsConfigured()) {
      try {
        const results = await google.geocodeDestination(query, userLocation);
        if (results && results.length > 0) {
          this.lastProvider.geocode = 'google';
          return results;
        }
      } catch (error) {
        console.warn('[routingAdapter] Google geocode lanzó excepción, usando ORS:', error);
      }
    }
    this.lastProvider.geocode = 'ors';
    return orsService.geocodeDestination(query, userLocation);
  }

  public async getDisambiguationCandidates(
    query: string | StructuredAddressQuery,
    userLocation?: Coordinates,
    maxCandidates = 3
  ): Promise<DisambiguationResult> {
    const queryString = typeof query === 'string' ? query : (query.rawQuery || query.street || '');
    if (queryString && queryString.trim()) {
      const aliasRes = AliasService.resolveDestinationWithAlias(queryString);
      if (aliasRes.isAlias && aliasRes.coordinates) {
        this.lastProvider.disambiguation = 'ors';
        return {
          isAmbiguous: false,
          candidates: [
            {
              id: aliasRes.alias?.id || 'alias-resolved',
              name: aliasRes.resolvedName,
              label: `${aliasRes.resolvedName} - ${aliasRes.alias?.address || 'Ubicación guardada'}`,
              colonia_o_alcaldia: aliasRes.alias?.address || 'Destino frecuente guardado',
              coordinates: aliasRes.coordinates,
              precision: 'exact',
            },
          ],
        };
      }
    }

    if (google.isGoogleMapsConfigured()) {
      try {
        const result = await google.getDisambiguationCandidates(query, userLocation, maxCandidates);
        if (result && result.candidates.length > 0) {
          this.lastProvider.disambiguation = 'google';
          return result;
        }
      } catch (error) {
        console.warn('[routingAdapter] Google desambiguación lanzó excepción, usando ORS:', error);
      }
    }
    this.lastProvider.disambiguation = 'ors';
    return orsService.getDisambiguationCandidates(query, userLocation, maxCandidates);
  }

  public async getDirections(start: Coordinates, destination: Coordinates): Promise<RouteResult> {
    if (google.isGoogleMapsConfigured()) {
      try {
        const route = await google.getDirections(start, destination);
        if (route && route.coordinates && route.coordinates.length >= 2) {
          this.lastProvider.directions = 'google';
          return route;
        }
      } catch (error) {
        console.warn('[routingAdapter] Google directions lanzó excepción, usando ORS:', error);
      }
    }
    this.lastProvider.directions = 'ors';
    try {
      const orsRoute = await orsService.getDirections(start, destination);
      if (orsRoute && orsRoute.coordinates && orsRoute.coordinates.length >= 2) {
        return orsRoute;
      }
    } catch (orsError) {
      console.warn('[routingAdapter] ORS getDirections falló, generando ruta de emergencia local:', orsError);
    }
    return orsService.generateFallbackRoute(start, destination);
  }
}

export const routingService = new RoutingService();
