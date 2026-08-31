import ExpoModulesCore
import MapKit

/// A place the map knows about, flattened for JavaScript.
struct LocalSearchResult: Record {
  @Field var name: String = ""
  /// Street line, when MapKit has one ("Rua Nova do Carvalho 45").
  @Field var address: String?
  /// Neighbourhood or city, for telling two identical names apart.
  @Field var locality: String?
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  /// MKPointOfInterestCategory raw value, e.g. "MKPOICategoryCafe".
  @Field var category: String?
}

/// Venue search using Apple's own point-of-interest index.
///
/// This exists because CLGeocoder — what `expo-location` exposes — only
/// resolves ADDRESSES. Someone dropping a pin thinks in venues ("Chatuchak
/// market", "Pensão Amor"), and geocoding those returns nothing, which read
/// as "search is broken". MKLocalSearch is the API Apple Maps itself uses.
///
/// Nothing here touches the user's location: the search region comes from the
/// city being browsed, which the app already knows. No entitlement, no API
/// key, and no location permission is requested or required.
public class LocalSearchModule: Module {
  private var activeSearch: MKLocalSearch?
  private var activeNearby: MKLocalSearch?

  public func definition() -> ModuleDefinition {
    Name("LocalSearch")

    AsyncFunction("searchAsync") {
      (
        query: String,
        latitude: Double,
        longitude: Double,
        radiusMeters: Double,
        limit: Int,
        promise: Promise
      ) in
      let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else {
        promise.resolve([LocalSearchResult]())
        return
      }

      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = trimmed
      request.region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
        latitudinalMeters: radiusMeters,
        longitudinalMeters: radiusMeters
      )
      // Venues first, but keep addresses so "Rua Nova do Carvalho 45" still
      // resolves — the field is one box and people type both kinds of thing.
      request.resultTypes = [.pointOfInterest, .address]

      // One search at a time: a new keystroke's search supersedes the last.
      self.activeSearch?.cancel()
      let search = MKLocalSearch(request: request)
      self.activeSearch = search

      search.start { response, error in
        if let error {
          let nsError = error as NSError
          // A cancelled or empty search is a normal outcome, not a failure:
          // resolve empty so the UI can say "no match" rather than "error".
          if nsError.domain == MKErrorDomain,
            nsError.code == MKError.placemarkNotFound.rawValue
              || nsError.code == MKError.unknown.rawValue {
            promise.resolve([LocalSearchResult]())
            return
          }
          promise.reject("ERR_LOCAL_SEARCH", error.localizedDescription)
          return
        }

        let items = response?.mapItems.prefix(max(1, limit)) ?? []
        let results: [LocalSearchResult] = items.map { item in
          let result = LocalSearchResult()
          let placemark = item.placemark
          result.name = item.name ?? placemark.name ?? trimmed
          result.address = [placemark.thoroughfare, placemark.subThoroughfare]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
            .nilIfEmpty
          result.locality = placemark.subLocality ?? placemark.locality
          result.latitude = placemark.coordinate.latitude
          result.longitude = placemark.coordinate.longitude
          result.category = item.pointOfInterestCategory?.rawValue
          return result
        }
        promise.resolve(results)
      }
    }
    // MapKit is main-thread-affine, and `activeSearch` is touched by every
    // call — pinning the function to the main queue satisfies both without a
    // lock. The search itself is asynchronous, so nothing blocks here.
    .runOnQueue(.main)

    /// The venues under a coordinate, with no query to type. Built on
    /// MKLocalPointsOfInterestRequest rather than MKLocalSearch.Request,
    /// because there is no natural-language query for "what is here".
    ///
    /// Same privacy shape as searchAsync: the coordinate is the map centre
    /// the person panned to, never a device location. No permission is
    /// requested or required.
    AsyncFunction("nearbyAsync") {
      (
        latitude: Double,
        longitude: Double,
        radiusMeters: Double,
        limit: Int,
        promise: Promise
      ) in
      let request = MKLocalPointsOfInterestRequest(
        center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
        radius: max(1, radiusMeters)
      )
      request.pointOfInterestFilter = .includingAll

      // One lookup at a time: a new settle's lookup supersedes the last.
      // Its own slot, not activeSearch — a nearby lookup must never cancel
      // a typed search that happens to be in flight, or vice versa.
      self.activeNearby?.cancel()
      let search = MKLocalSearch(request: request)
      self.activeNearby = search

      search.start { response, error in
        if let error {
          let nsError = error as NSError
          // Nothing at this spot (open water, sparse regions) and a
          // cancelled lookup are normal outcomes, not failures: resolve
          // empty so the chip row is simply absent.
          if nsError.domain == MKErrorDomain,
            nsError.code == MKError.placemarkNotFound.rawValue
              || nsError.code == MKError.unknown.rawValue {
            promise.resolve([LocalSearchResult]())
            return
          }
          promise.reject("ERR_LOCAL_SEARCH", error.localizedDescription)
          return
        }

        // Drop the nameless: a venue chip with no name is not an offer.
        let items = response?.mapItems ?? []
        let results: [LocalSearchResult] = items.prefix(max(1, limit)).compactMap { item in
          guard let name = item.name ?? item.placemark.name else {
            return nil
          }
          let result = LocalSearchResult()
          let placemark = item.placemark
          result.name = name
          result.address = [placemark.thoroughfare, placemark.subThoroughfare]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
            .nilIfEmpty
          result.locality = placemark.subLocality ?? placemark.locality
          result.latitude = placemark.coordinate.latitude
          result.longitude = placemark.coordinate.longitude
          result.category = item.pointOfInterestCategory?.rawValue
          return result
        }
        promise.resolve(results)
      }
    }
    // Same main-thread affinity as searchAsync, for the same reasons.
    .runOnQueue(.main)
  }
}

extension String {
  fileprivate var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}
