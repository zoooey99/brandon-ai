import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";

export default function Legal() {
  return (
    <div className="min-h-screen bg-background font-sans">
      <AppHeader showSubscriptionManagement={false} />

      <div className="max-w-3xl mx-auto px-6 py-12 pb-24">
        {/* Back link */}
        <Link href="/" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8">
          <ChevronLeft className="w-4 h-4" />
          Back to home
        </Link>

        <h1 className="text-4xl font-heading font-bold text-white mb-2">Legal</h1>
        <p className="text-zinc-400 mb-12">Last updated: January 23, 2026</p>

        {/* Table of Contents */}
        <nav className="glass-card p-6 mb-12">
          <h2 className="text-lg font-semibold text-white mb-4">Contents</h2>
          <ul className="space-y-2 text-zinc-400">
            <li>
              <a href="#terms" className="hover:text-white transition-colors">1. Terms of Service</a>
            </li>
            <li>
              <a href="#privacy" className="hover:text-white transition-colors">2. Privacy Policy</a>
            </li>
            <li>
              <a href="#health" className="hover:text-white transition-colors">3. Health &amp; Fitness Disclaimer</a>
            </li>
          </ul>
        </nav>

        {/* Terms of Service */}
        <section id="terms" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-heading font-bold text-white mb-6 pb-2 border-b border-zinc-800">
            1. Terms of Service
          </h2>

          <div className="prose prose-invert prose-zinc max-w-none space-y-6 text-zinc-300">
            <h3 className="text-xl font-semibold text-white mt-8">1.1 Service Description</h3>
            <p>
              Brandon AI ("Service," "we," "us," or "our") is an AI-powered fitness coaching application that provides
              personalized workout plans delivered via text message. Our Service includes AI-generated workout
              recommendations, progress tracking, and coaching support.
            </p>
            <p>
              <strong className="text-white">Important:</strong> Brandon is NOT a medical service, personal training
              certification program, or substitute for professional medical advice. The workouts and recommendations
              provided are for informational and educational purposes only.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">1.2 Eligibility</h3>
            <p>
              You must be at least 18 years old to use Brandon. By using our Service, you represent and warrant that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You are at least 18 years of age</li>
              <li>You are physically capable of engaging in exercise activities</li>
              <li>You have consulted with a healthcare provider if you have any medical conditions that may affect your ability to exercise safely</li>
              <li>All information you provide to us is accurate and complete</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">1.3 Account Responsibilities</h3>
            <p>
              When you create an account with Brandon, you are responsible for:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Maintaining the security of your account credentials</li>
              <li>All activities that occur under your account</li>
              <li>Providing accurate profile information including any health conditions or injuries</li>
              <li>Your own safety during any workout activities</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">1.4 Subscription &amp; Payment</h3>
            <p>
              Brandon offers subscription-based access to our Service:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Free Trial:</strong> New users receive a 7-day free trial. You will not be charged during this period.</li>
              <li><strong className="text-white">Billing:</strong> After your trial ends, your subscription will automatically renew and you will be charged the applicable subscription fee (monthly or yearly, based on your selection).</li>
              <li><strong className="text-white">Automatic Renewal:</strong> Subscriptions automatically renew unless cancelled before the renewal date.</li>
              <li><strong className="text-white">Price Changes:</strong> We may change subscription prices with 30 days notice. Price changes will take effect at your next renewal.</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">1.5 Cancellation &amp; Refunds</h3>
            <p>
              You may cancel your subscription at any time through your account settings or by contacting us at{" "}
              <a href="mailto:support@textbrandon.now" className="text-white underline">support@textbrandon.now</a>.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Cancellation:</strong> When you cancel, you will retain access to the Service until the end of your current billing period.</li>
              <li><strong className="text-white">Refunds:</strong> We do not provide refunds for partial subscription periods. If you cancel a yearly subscription, you will not receive a prorated refund for unused months.</li>
              <li><strong className="text-white">Trial Cancellation:</strong> If you cancel during your free trial, you will not be charged.</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">1.6 SMS Terms</h3>
            <p>
              By providing your phone number and using Brandon, you consent to receive text messages from us including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Daily workout reminders and check-ins</li>
              <li>Responses to your messages</li>
              <li>Service-related notifications</li>
            </ul>
            <p>
              <strong className="text-white">Message frequency varies.</strong> Message and data rates may apply.
              You can opt out at any time by replying STOP to any message. For help, reply HELP or contact us
              at <a href="mailto:support@textbrandon.now" className="text-white underline">support@textbrandon.now</a>.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">1.7 Intellectual Property</h3>
            <p>
              All content provided through Brandon, including workout plans, text, graphics, logos, and software,
              is owned by Brandon or its licensors and is protected by copyright and other intellectual property laws.
            </p>
            <p>
              You may not reproduce, distribute, modify, or create derivative works from our content without our
              prior written consent. You may not resell or redistribute workout plans or content from Brandon.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">1.8 Limitation of Liability</h3>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, BRANDON AI AND ITS AFFILIATES, OFFICERS, EMPLOYEES, AGENTS,
              AND LICENSORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
              DAMAGES, INCLUDING BUT NOT LIMITED TO PERSONAL INJURY, PAIN AND SUFFERING, EMOTIONAL DISTRESS, LOSS
              OF REVENUE, LOSS OF PROFITS, LOSS OF DATA, OR OTHER INTANGIBLE LOSSES.
            </p>
            <p>
              IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU EXCEED THE AMOUNTS PAID BY YOU TO BRANDON AI IN THE
              TWELVE (12) MONTHS PRIOR TO THE CLAIM.
            </p>
            <p>
              YOU EXPRESSLY UNDERSTAND AND AGREE THAT YOUR USE OF THE SERVICE IS AT YOUR SOLE RISK AND THAT
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE."
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">1.9 Termination</h3>
            <p>
              We may terminate or suspend your account and access to the Service immediately, without prior notice
              or liability, for any reason, including if you breach these Terms. Upon termination, your right to
              use the Service will immediately cease.
            </p>
            <p>
              You may terminate your account at any time by cancelling your subscription and ceasing to use the Service.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">1.10 Governing Law</h3>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the State of Delaware,
              without regard to its conflict of law provisions. Any disputes arising from these Terms or your use
              of the Service shall be resolved in the state or federal courts located in Delaware.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">1.11 Changes to Terms</h3>
            <p>
              We reserve the right to modify these Terms at any time. We will notify you of any changes by posting
              the new Terms on this page and updating the "Last updated" date. Your continued use of the Service
              after such modifications constitutes your acceptance of the new Terms.
            </p>
          </div>
        </section>

        {/* Privacy Policy */}
        <section id="privacy" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-heading font-bold text-white mb-6 pb-2 border-b border-zinc-800">
            2. Privacy Policy
          </h2>

          <div className="prose prose-invert prose-zinc max-w-none space-y-6 text-zinc-300">
            <h3 className="text-xl font-semibold text-white mt-8">2.1 Information We Collect</h3>

            <h4 className="text-lg font-medium text-white mt-6">Information You Provide</h4>
            <p>When you use Brandon, we collect information you directly provide:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Account Information:</strong> Name, email address (via Google Sign-In)</li>
              <li><strong className="text-white">Contact Information:</strong> Phone number for SMS delivery</li>
              <li><strong className="text-white">Profile Information:</strong> Age, sex, fitness goals, experience level, equipment access</li>
              <li><strong className="text-white">Health Information:</strong> Any injuries, limitations, or health notes you voluntarily provide</li>
              <li><strong className="text-white">Workout Data:</strong> Exercise completion, weights lifted, sets, reps, and workout history</li>
              <li><strong className="text-white">Communications:</strong> Messages you send to our AI coach</li>
            </ul>

            <h4 className="text-lg font-medium text-white mt-6">Information Collected Automatically</h4>
            <p>We automatically collect certain information when you use our Service:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Usage Data:</strong> Pages visited, features used, workout completion patterns</li>
              <li><strong className="text-white">Device Information:</strong> Browser type, operating system, device identifiers</li>
              <li><strong className="text-white">Analytics:</strong> We use PostHog for analytics, which may include session recordings to improve user experience</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">2.2 How We Use Your Information</h3>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide and personalize the Service, including generating workout plans</li>
              <li>Send you workout reminders and coaching messages via SMS</li>
              <li>Process your subscription and payments</li>
              <li>Respond to your inquiries and provide customer support</li>
              <li>Analyze usage patterns to improve our Service</li>
              <li>Send service-related communications</li>
              <li>Comply with legal obligations</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">2.3 Information Sharing</h3>
            <p>We share your information with the following third-party service providers:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Stripe:</strong> Payment processing (we do not store your credit card information)</li>
              <li><strong className="text-white">Supabase:</strong> Authentication and database services</li>
              <li><strong className="text-white">Google:</strong> OAuth sign-in services</li>
              <li><strong className="text-white">PostHog:</strong> Analytics and product improvement</li>
              <li><strong className="text-white">OpenAI:</strong> AI workout generation (your fitness profile is used to create personalized plans)</li>
              <li><strong className="text-white">SMS Provider:</strong> Text message delivery</li>
            </ul>
            <p>
              We do not sell your personal information to third parties. We may disclose information if required
              by law or to protect our rights and safety.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">2.4 Data Retention</h3>
            <p>
              We retain your personal information for as long as your account is active or as needed to provide
              you with the Service. If you delete your account, we will delete or anonymize your personal information
              within 30 days, except as required by law or for legitimate business purposes.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">2.5 Your Rights</h3>
            <p>Depending on your location, you may have the following rights:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Access:</strong> Request a copy of your personal data</li>
              <li><strong className="text-white">Correction:</strong> Request correction of inaccurate data</li>
              <li><strong className="text-white">Deletion:</strong> Request deletion of your personal data</li>
              <li><strong className="text-white">Opt-out:</strong> Opt out of marketing communications or analytics</li>
            </ul>
            <p>
              To exercise these rights, contact us at{" "}
              <a href="mailto:support@textbrandon.now" className="text-white underline">support@textbrandon.now</a>.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">2.6 Security</h3>
            <p>
              We implement appropriate technical and organizational measures to protect your personal information,
              including encryption in transit (HTTPS) and secure storage. However, no method of transmission over
              the Internet is 100% secure, and we cannot guarantee absolute security.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">2.7 Children's Privacy</h3>
            <p>
              Brandon is not intended for users under 18 years of age. We do not knowingly collect personal
              information from children under 18. If we learn we have collected personal information from a
              child under 18, we will delete that information promptly.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">2.8 Changes to Privacy Policy</h3>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting
              the new Privacy Policy on this page and updating the "Last updated" date.
            </p>
          </div>
        </section>

        {/* Health Disclaimer */}
        <section id="health" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-heading font-bold text-white mb-6 pb-2 border-b border-zinc-800">
            3. Health &amp; Fitness Disclaimer
          </h2>

          <div className="prose prose-invert prose-zinc max-w-none space-y-6 text-zinc-300">
            <div className="glass-card p-6 border-amber-500/30 bg-amber-500/5">
              <p className="text-amber-200 font-medium mb-4">
                PLEASE READ THIS DISCLAIMER CAREFULLY BEFORE USING BRANDON
              </p>
              <p className="text-zinc-300">
                Brandon provides AI-generated workout suggestions for informational purposes only. Brandon is
                <strong className="text-white"> NOT a substitute for professional medical advice, diagnosis, or treatment.</strong>
              </p>
            </div>

            <h3 className="text-xl font-semibold text-white mt-8">3.1 Consult Your Healthcare Provider</h3>
            <p>
              Before starting any fitness program, including workouts provided by Brandon, you should:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Consult with a qualified healthcare provider</li>
              <li>Get medical clearance if you have any health conditions, injuries, or concerns</li>
              <li>Discuss any medications that may affect your ability to exercise</li>
              <li>Inform your doctor if you are pregnant, nursing, or have recently given birth</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">3.2 Assumption of Risk</h3>
            <p>
              By using Brandon, you acknowledge and agree that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Physical exercise involves inherent risks, including the risk of injury</li>
              <li>You are voluntarily participating in exercise activities at your own risk</li>
              <li>You are solely responsible for your health and safety during workouts</li>
              <li>You will stop exercising immediately if you experience pain, dizziness, shortness of breath, or any other concerning symptoms</li>
              <li>AI-generated workouts may not account for all individual health factors</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">3.3 No Guarantees</h3>
            <p>
              Brandon makes no guarantees regarding:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Specific fitness results or outcomes</li>
              <li>Weight loss, muscle gain, or other physical changes</li>
              <li>The suitability of any workout for your specific circumstances</li>
              <li>The accuracy or completeness of AI-generated recommendations</li>
            </ul>
            <p>
              Individual results vary based on many factors including genetics, diet, consistency, and effort.
            </p>

            <h3 className="text-xl font-semibold text-white mt-8">3.4 Limitation of Liability</h3>
            <p>
              Brandon AI and its creators, affiliates, employees, and agents shall not be liable for any injuries,
              health problems, or damages of any kind resulting from your use of the Service, including but not limited to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Physical injuries sustained during exercise</li>
              <li>Aggravation of pre-existing conditions</li>
              <li>Health complications from following workout recommendations</li>
              <li>Damages from reliance on AI-generated content</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mt-8">3.5 Emergency Situations</h3>
            <p>
              If you experience a medical emergency, call 911 or your local emergency services immediately.
              Brandon is not an emergency service and cannot provide medical assistance.
            </p>
          </div>
        </section>

        {/* Contact Section */}
        <section className="glass-card p-8 text-center">
          <h2 className="text-xl font-semibold text-white mb-4">Questions?</h2>
          <p className="text-zinc-400 mb-4">
            If you have any questions about these terms, please contact us:
          </p>
          <a
            href="mailto:support@textbrandon.now"
            className="text-white underline hover:text-zinc-300 transition-colors"
          >
            support@textbrandon.now
          </a>
        </section>
      </div>
    </div>
  );
}
