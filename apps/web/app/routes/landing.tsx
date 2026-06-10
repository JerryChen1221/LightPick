import Background from "@lightpick/web-ui/components/Background";
import LandingNav from "@lightpick/web-ui/components/landing/LandingNav";
import LandingHero from "@lightpick/web-ui/components/landing/LandingHero";
import FeatureGrid from "@lightpick/web-ui/components/landing/FeatureGrid";
import HowItWorks from "@lightpick/web-ui/components/landing/HowItWorks";
import UseCases from "@lightpick/web-ui/components/landing/UseCases";
import Pricing from "@lightpick/web-ui/components/landing/Pricing";
import CTASection from "@lightpick/web-ui/components/landing/CTASection";
import BlogPreview from "@lightpick/web-ui/components/landing/BlogPreview";
import LandingFooter from "@lightpick/web-ui/components/landing/LandingFooter";

export default function LandingRoute() {
  return (
    <div className="relative">
      <Background />
      <LandingNav />
      <LandingHero />
      <FeatureGrid />
      <HowItWorks />
      <UseCases />
      <Pricing />
      <CTASection />
      <BlogPreview />
      <LandingFooter />
    </div>
  );
}
