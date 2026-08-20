# Without this file the module is found but never linked: autolinking's
# resolve step drops any module whose directory contains no podspec, so the
# build would succeed and the Swift beside it would never be compiled in.
Pod::Spec.new do |s|
  s.name           = 'LocalSearch'
  s.version        = '1.0.0'
  s.summary        = 'Venue search through MapKit, for placing a pin by name.'
  s.description    = 'Wraps MKLocalSearch so the app can resolve venue names, which CLGeocoder cannot. No API key, entitlement, or location permission.'
  s.author         = 'Samewhere'
  s.homepage       = 'https://github.com/mattmoore24/travel_app'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
